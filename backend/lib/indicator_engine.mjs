export function computeIndicatorPack(market = {}) {
  const candles = Array.isArray(market.candles) ? market.candles : [];
  const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
  const highs = candles.map((c) => Number(c.high)).filter(Number.isFinite);
  const lows = candles.map((c) => Number(c.low)).filter(Number.isFinite);
  const vols = candles.map((c) => Number(c.volume || 0)).filter(Number.isFinite);

  const close = Number(market.lastPrice ?? closes.at(-1) ?? 0);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(highs, lows, closes, 14);
  const volRatio = volumeRatio(vols, 5, 20);
  const slope5 = slopePct(closes, 5);

  const trendScore = scoreTrend({ close, ma5, ma10, ma20, slope5 });
  const momentumScore = scoreMomentum({ rsi14, market });
  const liquidityScore = scoreLiquidity({ volRatio, market });
  const volatilityScore = scoreVolatility({ atr14, close });
  const breadthProxyScore = clamp((Number(market.sentiment ?? 0.5) + Number(market.sectorHeat ?? 0.5)) / 2, 0, 1);

  const composite = clamp(
    trendScore * 0.32 +
      momentumScore * 0.23 +
      liquidityScore * 0.20 +
      breadthProxyScore * 0.15 +
      (1 - Math.abs(volatilityScore - 0.5)) * 0.10,
    0,
    1
  );

  return {
    source: market.source || 'unknown',
    asOf: market.asOf || new Date().toISOString(),
    inputs: {
      candles: candles.length,
      close,
      dayChangePct: Number(market.dayChangePct ?? 0)
    },
    metrics: {
      ma5: round2(ma5),
      ma10: round2(ma10),
      ma20: round2(ma20),
      rsi14: round2(rsi14),
      atr14: round2(atr14),
      volRatio: round2(volRatio),
      slope5Pct: round2(slope5)
    },
    scores: {
      trend: round2(trendScore),
      momentum: round2(momentumScore),
      liquidity: round2(liquidityScore),
      volatility: round2(volatilityScore),
      breadthProxy: round2(breadthProxyScore),
      composite: round2(composite)
    },
    bias: composite >= 0.62 ? 'bullish' : composite <= 0.38 ? 'bearish' : 'neutral'
  };
}

function scoreTrend({ close, ma5, ma10, ma20, slope5 }) {
  let s = 0.5;
  if (finite(close) && finite(ma5)) s += close > ma5 ? 0.10 : -0.10;
  if (finite(ma5) && finite(ma10)) s += ma5 > ma10 ? 0.10 : -0.10;
  if (finite(ma10) && finite(ma20)) s += ma10 > ma20 ? 0.12 : -0.12;
  if (finite(slope5)) s += clamp(slope5 / 2.5, -0.12, 0.12);
  return clamp(s, 0, 1);
}

function scoreMomentum({ rsi14, market }) {
  let s = 0.5;
  if (finite(rsi14)) {
    if (rsi14 >= 55 && rsi14 <= 72) s += 0.18;
    else if (rsi14 > 72) s -= 0.05;
    else if (rsi14 < 45 && rsi14 >= 30) s -= 0.10;
    else if (rsi14 < 30) s += 0.04;
  }
  s += clamp(Number(market.dayChangePct || 0) / 8, -0.12, 0.12);
  return clamp(s, 0, 1);
}

function scoreLiquidity({ volRatio, market }) {
  let s = 0.45 + clamp((Number(market.turnoverHeat || 0.5) - 0.5) * 0.4, -0.2, 0.2);
  if (finite(volRatio)) s += clamp((volRatio - 1) * 0.25, -0.15, 0.2);
  return clamp(s, 0, 1);
}

function scoreVolatility({ atr14, close }) {
  if (!finite(atr14) || !finite(close) || close <= 0) return 0.5;
  const atrPct = (atr14 / close) * 100;
  if (atrPct < 0.8) return 0.35;
  if (atrPct <= 2.5) return 0.65;
  if (atrPct <= 4.2) return 0.55;
  return 0.25;
}

function volumeRatio(vols, shortN = 5, longN = 20) {
  const short = sma(vols, shortN);
  const long = sma(vols, longN);
  if (!finite(short) || !finite(long) || long <= 0) return 1;
  return short / long;
}

function atr(highs, lows, closes, n = 14) {
  if (highs.length < 2 || lows.length < 2 || closes.length < 2) return NaN;
  const trs = [];
  for (let i = 1; i < Math.min(highs.length, lows.length, closes.length); i++) {
    const h = highs[i];
    const l = lows[i];
    const pc = closes[i - 1];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return sma(trs, n);
}

function rsi(closes, n = 14) {
  if (closes.length < n + 1) return NaN;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses += -d;
  }
  if (losses === 0) return 100;
  const rs = (gains / n) / (losses / n);
  return 100 - 100 / (1 + rs);
}

function slopePct(values, n = 5) {
  if (values.length < n) return NaN;
  const segment = values.slice(-n);
  const first = segment[0];
  const last = segment[segment.length - 1];
  if (!finite(first) || first === 0 || !finite(last)) return NaN;
  return ((last - first) / first) * 100;
}

function sma(values, n) {
  if (!Array.isArray(values) || values.length < n || n <= 0) return NaN;
  const seg = values.slice(-n);
  const nums = seg.filter(Number.isFinite);
  if (nums.length !== n) return NaN;
  return nums.reduce((a, b) => a + b, 0) / n;
}

function finite(v) {
  return Number.isFinite(Number(v));
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}
