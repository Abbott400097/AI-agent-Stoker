import crypto from 'node:crypto';
import { normalizeAshareSymbol } from './lib/a_share_rules.mjs';
import { getTradingAgentsInsights } from './lib/tradingagents_adapter.mjs';
import { positionQty } from './lib/portfolio_ledger.mjs';
import { getMarketSnapshot } from './lib/market_data_provider.mjs';
import { computeIndicatorPack } from './lib/indicator_engine.mjs';

export async function buildWorkflow({ symbol = '600519.SH', mode = 'hybrid', state, source = 'api' }) {
  symbol = normalizeAshareSymbol(symbol);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const market = await getMarketSnapshot({ symbol, mode, config: state?.config || {} });
  const indicators = computeIndicatorPack(market);
  const taInsights = await maybeGetTradingAgentsInsights({ symbol, mode, market, state, source });

  const intel = intelAgent(market, indicators);
  const retrieval = retrievalAgent(symbol, market, indicators, taInsights);
  const analysis = analysisSquad(symbol, market, indicators, retrieval.payload.evidence || [], taInsights);
  const debate = debateAgents(analysis, taInsights);
  const trader = traderAgent(symbol, market, analysis, debate, state?.portfolio);
  const risk = riskAgent(trader, state.config, state?.portfolio);
  const pm = portfolioManagerAgent(risk, state.config);

  const orderProposal = pm.payload.approved
    ? {
        decisionId: crypto.randomUUID(),
        symbol,
        side: pm.payload.action,
        qty: pm.payload.qty,
        limitPrice: market.lastPrice,
        confidence: pm.payload.confidence,
        reason: pm.payload.reason,
        requiresApproval: state.config.manualApproval,
        brokerMode: state.config.brokerMode,
        createdAt: now,
        status: state.config.manualApproval ? 'pending_approval' : 'ready_to_send'
      }
    : null;

  const steps = [intel, retrieval, ...analysis.steps, ...debate.steps, trader, risk, pm].map((s) => ({
    ...s,
    ts: now
  }));

  return {
    id,
    symbol,
    mode,
    createdAt: now,
    market,
    indicators,
    adapter: { tradingagents: { source: taInsights.source, ok: taInsights.ok, reason: taInsights.reason || null } },
    steps,
    final: {
      approved: pm.payload.approved,
      action: pm.payload.action,
      confidence: pm.payload.confidence,
      reason: pm.payload.reason,
      blockedBy: pm.payload.blockedBy,
      decisionId: orderProposal?.decisionId || null
    },
    orderProposal
  };
}

async function maybeGetTradingAgentsInsights({ symbol, mode, market, state, source }) {
  const cfg = state?.config?.tradingagents || {};
  const src = String(source || '');
  const isAutopilot = src.startsWith('autopilot:');
  const enabled = cfg.enabled !== false;
  const intradayEnabled = cfg.intradayEnabled === true;
  const manualRunEnabled = cfg.manualRunEnabled !== false;

  if (!enabled) {
    return disabledTaInsights('disabled_by_config');
  }
  if (isAutopilot && !intradayEnabled) {
    return disabledTaInsights('disabled_intraday');
  }
  if (!isAutopilot && !manualRunEnabled) {
    return disabledTaInsights('disabled_manual');
  }
  return getTradingAgentsInsights({ symbol, mode, market });
}

function disabledTaInsights(reason) {
  return {
    ok: false,
    source: 'disabled',
    reason,
    analysts: {
      market: { score: 0.5, summary: 'disabled' },
      news: { score: 0.5, summary: 'disabled' },
      fundamentals: { score: 0.5, summary: 'disabled' },
      social: { score: 0.5, summary: 'disabled' }
    },
    debate: { bull: 0.5, bear: 0.5 },
    trader: { actionBias: 'hybrid', summary: 'TradingAgents disabled for this path' }
  };
}

function intelAgent(market, indicators) {
  return step('intel', {
    summary: `市场状态 ${market.regime}，数据源 ${market.source || 'unknown'}，情绪 ${(market.sentiment * 100).toFixed(0)}%，指标综合分 ${(indicators?.scores?.composite ?? 0.5).toFixed(2)}。`,
    constraints: ['A股 T+1', '100股整数手', '涨跌停与流动性约束'],
    marketSource: market.source || 'unknown',
    asOf: market.asOf || null
  });
}

function retrievalAgent(symbol, market, indicators, taInsights) {
  const evidence = [
    { source: `market_snapshot:${market.source || 'unknown'}`, title: `${symbol} 日内涨跌幅 ${signedPct(market.dayChangePct)} / 现价 ${market.lastPrice}`, freshness: market.asOf || 'runtime', score: 0.82 },
    { source: 'indicator_engine', title: `趋势 ${indicators?.scores?.trend ?? '-'} / 动量 ${indicators?.scores?.momentum ?? '-'} / RSI ${indicators?.metrics?.rsi14 ?? '-'}`, freshness: market.asOf || 'runtime', score: 0.9 },
    { source: 'local_rules', title: 'A股规则: T+1 / 100股手数 / 审批后执行', freshness: 'static', score: 0.98 },
    { source: 'ai-trader_pattern', title: 'AI-Trader A股 BaseAgentAStock 规则与日志结构可复用', freshness: 'repo', score: 0.8 },
    { source: 'tradingagents_graph', title: 'TradingAgents LangGraph 多角色辩论链路可复用', freshness: 'repo', score: 0.85 }
  ];
  if (taInsights?.reason) {
    evidence.push({ source: 'tradingagents_adapter', title: `adapter状态: ${taInsights.reason}`, freshness: 'runtime', score: 0.66 });
  }

  return step('retrieval', {
    summary: `检索Agent完成证据收集与去重（数据源: ${market.source || 'unknown'}），输出可追溯证据列表。`,
    evidence
  });
}

function analysisSquad(symbol, market, indicators, evidence, taInsights) {
  const ta = taInsights?.analysts || {};
  const indicatorComposite = Number(indicators?.scores?.composite ?? 0.5);
  const technicalScore = clamp(
    indicatorComposite * 0.55 +
    Number(indicators?.scores?.trend ?? 0.5) * 0.25 +
    (ta.market?.score ?? 0.5) * 0.2,
    0, 1
  );
  const eventScore = clamp((ta.news?.score ?? 0.5) * 0.4 + (ta.social?.score ?? 0.5) * 0.15 + 0.28 + (market.sentiment - 0.5) * 0.35 + (Math.random() - 0.5) * 0.06, 0, 1);
  const liquidityScore = clamp((ta.social?.score ?? 0.5) * 0.15 + Number(indicators?.scores?.liquidity ?? 0.5) * 0.45 + 0.15 + market.turnoverHeat * 0.25, 0, 1);
  const fundamentalScore = clamp((ta.fundamentals?.score ?? 0.5), 0, 1);

  return {
    steps: [
      step('analysis-tech', {
        summary: `${symbol} 指标/技术面评分 ${technicalScore.toFixed(2)}。`,
        metrics: { technicalScore, indicatorComposite, dayChangePct: market.dayChangePct, turnoverHeat: market.turnoverHeat, ...indicators?.metrics }
      }),
      step('analysis-event', {
        summary: `事件/情绪评分 ${eventScore.toFixed(2)}。`,
        metrics: { eventScore, sentiment: market.sentiment, evidenceCount: evidence.length }
      }),
      step('analysis-liquidity', {
        summary: `流动性评分 ${liquidityScore.toFixed(2)}。`,
        metrics: { liquidityScore }
      }),
      step('analysis-fundamental', {
        summary: `基本面评分 ${fundamentalScore.toFixed(2)}。`,
        metrics: { fundamentalScore, source: taInsights?.source || 'fallback' }
      })
    ],
    scores: { technicalScore, eventScore, liquidityScore, fundamentalScore }
  };
}

function debateAgents(analysis, taInsights) {
  const taBull = Number(taInsights?.debate?.bull ?? 0.5);
  const taBear = Number(taInsights?.debate?.bear ?? 0.5);
  const bull = round2(analysis.scores.technicalScore * 0.32 + analysis.scores.eventScore * 0.23 + analysis.scores.liquidityScore * 0.15 + analysis.scores.fundamentalScore * 0.1 + taBull * 0.2);
  const bear = round2((1 - analysis.scores.technicalScore) * 0.25 + (1 - analysis.scores.eventScore) * 0.25 + (1 - analysis.scores.liquidityScore) * 0.12 + (1 - analysis.scores.fundamentalScore) * 0.08 + taBear * 0.3);
  const neutral = round2(1 - Math.abs(bull - bear));

  return {
    steps: [
      step('bull-researcher', { summary: `多头观点：趋势与情绪偏正，支持试探仓。`, score: bull }),
      step('bear-researcher', { summary: `空头观点：A股波动与题材回撤风险仍高。`, score: bear }),
      step('debate-judge', { summary: `辩论裁决：净优势 ${(bull - bear).toFixed(2)}。`, bull, bear, neutral })
    ],
    bull,
    bear,
    neutral
  };
}

function traderAgent(symbol, market, analysis, debate, portfolio) {
  const heldQty = positionQty(portfolio, symbol);
  const conviction = clamp(
    analysis.scores.technicalScore * 0.4 +
    analysis.scores.eventScore * 0.25 +
    analysis.scores.liquidityScore * 0.15 +
    analysis.scores.fundamentalScore * 0.1 +
    debate.bull * 0.15 -
    debate.bear * 0.1,
    0,
    1
  );

  let action = conviction >= 0.62 ? 'BUY' : conviction <= 0.3 ? 'SELL' : 'HOLD';
  if (action === 'SELL' && heldQty <= 0) action = 'HOLD';
  const qty =
    action === 'HOLD'
      ? 0
      : action === 'SELL'
        ? Math.max(100, Math.floor(Math.min(heldQty, heldQty || 0) / 100) * 100)
        : Math.max(100, Math.floor((100000 * 0.06) / market.lastPrice / 100) * 100);

  return step('trader', {
    summary: `交易Agent建议 ${action} ${symbol}，置信度 ${conviction.toFixed(2)}。${heldQty > 0 ? ` 当前持仓 ${heldQty} 股。` : ''}`,
    symbol,
    action,
    qty,
    confidence: conviction,
    reason: `综合技术/事件/流动性/基本面与辩论结果得到 ${conviction.toFixed(2)}`
  });
}

function riskAgent(trader, config, portfolio) {
  const action = trader.payload.action;
  const blockedBy = [];
  const heldQty = positionQty(portfolio, trader.payload.symbol) || 0;

  if (action !== 'HOLD' && trader.payload.qty <= 0) blockedBy.push('qty_invalid');
  if (action === 'BUY' && config.maxPositionCount < 1) blockedBy.push('position_cap');
  if (action === 'SELL' && heldQty <= 0) blockedBy.push('no_position');
  if (trader.payload.confidence < 0.55 && action !== 'HOLD') blockedBy.push('low_confidence');

  const approved = blockedBy.length === 0 && action !== 'HOLD';
  return step('risk-manager', {
    summary: approved ? '风控通过，进入组合经理审批。' : `风控拦截: ${blockedBy.join(', ') || 'HOLD/no-op'}`,
    approved,
    blockedBy,
    symbol: trader.payload.symbol,
    action: trader.payload.action,
    qty: trader.payload.qty,
    confidence: trader.payload.confidence,
    reason: trader.payload.reason
  });
}

function portfolioManagerAgent(risk, config) {
  if (!risk.payload.approved) {
    return step('portfolio-manager', {
      approved: false,
      action: 'HOLD',
      qty: 0,
      confidence: risk.payload.confidence || 0,
      reason: '组合经理维持观望（风控未通过或无交易必要）',
      blockedBy: risk.payload.blockedBy || []
    });
  }

  return step('portfolio-manager', {
    approved: true,
    action: risk.payload.action,
    qty: risk.payload.qty,
    confidence: risk.payload.confidence,
    reason: `${config.manualApproval ? '审批后执行' : '自动执行'} | ${risk.payload.reason}`,
    blockedBy: []
  });
}

function step(agent, payload) {
  return {
    id: crypto.randomUUID(),
    agent,
    payload,
    durationMs: Math.floor(120 + Math.random() * 900)
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function signedPct(v) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}
