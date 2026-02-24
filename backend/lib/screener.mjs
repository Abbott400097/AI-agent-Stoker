import crypto from 'node:crypto';
import { normalizeAshareSymbol } from './a_share_rules.mjs';
import { getMarketSnapshot } from './market_data_provider.mjs';
import { computeIndicatorPack } from './indicator_engine.mjs';

export function createScreener({ getState, save }) {
  return {
    status,
    run,
    listCandidates,
    addManualSymbol,
    removeManualSymbol,
    getEffectiveUniverse
  };

  function ensureShape() {
    const state = getState();
    state.screener ||= { candidates: [], manualSymbols: [], lastRun: null, lastError: null, lastResult: null };
    state.config ||= {};
    state.config.screener ||= {
      enabled: false,
      topN: 8,
      minScore: 0.48,
      autoApplyToAutopilot: true,
      universe: []
    };
    return state;
  }

  function listCandidates() {
    const state = ensureShape();
    return {
      ok: true,
      screener: state.screener,
      config: state.config.screener,
      effectiveUniverse: getEffectiveUniverse()
    };
  }

  function status() {
    return listCandidates();
  }

  function addManualSymbol(symbol) {
    const state = ensureShape();
    const norm = normalizeAshareSymbol(symbol || '');
    if (!norm) return { ok: false, error: 'symbol_required' };
    state.screener.manualSymbols = uniq([...(state.screener.manualSymbols || []), norm]);
    if (state.config.screener?.autoApplyToAutopilot) {
      state.config.autopilot ||= {};
      state.config.autopilot.universe = uniq([...(state.config.autopilot.universe || []), norm]);
    }
    save();
    return { ok: true, added: norm, manualSymbols: state.screener.manualSymbols, effectiveUniverse: getEffectiveUniverse() };
  }

  function removeManualSymbol(symbol) {
    const state = ensureShape();
    const norm = normalizeAshareSymbol(symbol || '');
    state.screener.manualSymbols = (state.screener.manualSymbols || []).filter((s) => s !== norm);
    if (Array.isArray(state.config?.autopilot?.universe)) {
      state.config.autopilot.universe = state.config.autopilot.universe.filter((s) => s !== norm);
    }
    save();
    return { ok: true, removed: norm, manualSymbols: state.screener.manualSymbols, effectiveUniverse: getEffectiveUniverse() };
  }

  async function run(options = {}) {
    const state = ensureShape();
    const cfg = { ...(state.config.screener || {}), ...(options || {}) };
    const topN = Math.max(1, Number(cfg.topN || 8));
    const minScore = Number.isFinite(Number(cfg.minScore)) ? Number(cfg.minScore) : 0.48;
    const baseUniverse = sanitizeUniverse(
      Array.isArray(options.universe) && options.universe.length
        ? options.universe
        : Array.isArray(cfg.universe) && cfg.universe.length
          ? cfg.universe
          : state.config.defaultUniverse || []
    );
    const manualSymbols = sanitizeUniverse(state.screener.manualSymbols || []);
    const scanUniverse = uniq([...baseUniverse, ...manualSymbols]);
    const mode = String(options.mode || 'trend').toLowerCase();
    const rows = [];
    const startedAt = new Date().toISOString();

    try {
      for (const symbol of scanUniverse) {
        const market = await getMarketSnapshot({ symbol, mode, config: state.config || {} });
        const indicators = computeIndicatorPack(market);
        const score = scoreCandidate({ market, indicators });
        rows.push({
          symbol,
          score: round2(score),
          market: {
            source: market.source || 'unknown',
            asOf: market.asOf || null,
            lastPrice: market.lastPrice,
            dayChangePct: market.dayChangePct,
            turnoverHeat: market.turnoverHeat,
            regime: market.regime,
            sentiment: market.sentiment
          },
          indicators: {
            bias: indicators.bias,
            composite: indicators.scores?.composite ?? 0,
            trend: indicators.scores?.trend ?? 0,
            momentum: indicators.scores?.momentum ?? 0,
            liquidity: indicators.scores?.liquidity ?? 0,
            rsi14: indicators.metrics?.rsi14 ?? null,
            volRatio: indicators.metrics?.volRatio ?? null
          },
          reasons: buildReasons({ market, indicators, score })
        });
      }

      rows.sort((a, b) => b.score - a.score);
      const candidates = rows.filter((r) => r.score >= minScore).slice(0, topN);
      const candidateSymbols = candidates.map((c) => c.symbol);

      const result = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        source: 'premarket_screener',
        mode,
        topN,
        minScore: round2(minScore),
        scanned: scanUniverse.length,
        accepted: candidates.length,
        scanUniverse,
        candidates
      };

      state.screener.lastRun = result.ts;
      state.screener.lastError = null;
      state.screener.lastResult = result;
      state.screener.candidates = candidates;
      state.config.screener = { ...(state.config.screener || {}), topN, minScore };

      if (cfg.autoApplyToAutopilot ?? state.config.screener.autoApplyToAutopilot) {
        state.config.screener.autoApplyToAutopilot = true;
        state.config.autopilot ||= {};
        state.config.autopilot.universe = uniq([...manualSymbols, ...candidateSymbols]);
      }

      save();
      return { ok: true, type: 'screener_run', startedAt, result, effectiveUniverse: getEffectiveUniverse() };
    } catch (error) {
      state.screener.lastError = String(error?.message || error);
      save();
      return { ok: false, error: state.screener.lastError };
    }
  }

  function getEffectiveUniverse() {
    const state = ensureShape();
    const manual = sanitizeUniverse(state.screener.manualSymbols || []);
    const suggested = (state.screener.candidates || []).map((c) => normalizeAshareSymbol(c.symbol)).filter(Boolean);
    const autopilot = sanitizeUniverse(state.config?.autopilot?.universe || []);
    return uniq([...manual, ...autopilot, ...suggested]);
  }
}

function scoreCandidate({ market, indicators }) {
  const composite = Number(indicators?.scores?.composite ?? 0.5);
  const trend = Number(indicators?.scores?.trend ?? 0.5);
  const momentum = Number(indicators?.scores?.momentum ?? 0.5);
  const liquidity = Number(indicators?.scores?.liquidity ?? 0.5);
  const turnover = Number(market?.turnoverHeat ?? 0.5);
  const sectorHeat = Number(market?.sectorHeat ?? 0.5);
  const sentiment = Number(market?.sentiment ?? 0.5);
  const dayChange = Number(market?.dayChangePct ?? 0);
  const changeBoost = dayChange > 0 ? Math.min(0.08, dayChange / 100) : Math.max(-0.05, dayChange / 200);
  const regimeAdj = market?.regime === 'risk-off' ? -0.03 : market?.regime === 'risk-on' ? 0.03 : 0;
  return clamp(
    composite * 0.42 +
      trend * 0.14 +
      momentum * 0.12 +
      liquidity * 0.14 +
      turnover * 0.08 +
      sectorHeat * 0.05 +
      sentiment * 0.05 +
      changeBoost +
      regimeAdj,
    0,
    1
  );
}

function buildReasons({ market, indicators, score }) {
  const reasons = [];
  if ((indicators?.scores?.trend ?? 0) >= 0.6) reasons.push('趋势评分较强');
  if ((indicators?.scores?.momentum ?? 0) >= 0.58) reasons.push('动量改善');
  if ((indicators?.scores?.liquidity ?? 0) >= 0.55) reasons.push('流动性较好');
  if ((indicators?.metrics?.volRatio ?? 0) >= 1.2) reasons.push('量比放大');
  if (Number(market?.dayChangePct ?? 0) > 1.5) reasons.push('盘前/分时强势');
  if (reasons.length === 0) reasons.push(`综合评分 ${round2(score)}`);
  return reasons.slice(0, 4);
}

function sanitizeUniverse(values) {
  if (!Array.isArray(values)) return [];
  return uniq(values.map((s) => normalizeAshareSymbol(s)).filter(Boolean));
}

function uniq(arr) {
  return [...new Set(arr)];
}

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
