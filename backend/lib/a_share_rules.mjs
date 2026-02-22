export function normalizeAshareSymbol(symbol) {
  if (!symbol) return '';
  const s = String(symbol).toUpperCase().trim();
  if (s.endsWith('.SH') || s.endsWith('.SZ')) return s;
  if (/^(6\d{5})$/.test(s)) return `${s}.SH`;
  if (/^([03]\d{5})$/.test(s)) return `${s}.SZ`;
  return s;
}

export function isAshareSymbol(symbol) {
  return /\.(SH|SZ)$/.test(String(symbol || '').toUpperCase());
}

export function ensureLotSize(qty, lotSize = 100) {
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return { ok: false, reason: 'qty_invalid' };
  if (q % lotSize !== 0) return { ok: false, reason: 'not_lot_size', lotSize };
  return { ok: true, qty: q };
}

export function evaluateDecisionForAshare(decision, options = {}) {
  const {
    maxPositionCount = 4,
    maxDailyLossPct = 2,
    pendingPositions = 0,
    forceManualApproval = true,
    t1Locked = false,
    currentPositionQty = 0
  } = options;

  const blocks = [];
  const symbol = normalizeAshareSymbol(decision?.symbol);
  const side = String(decision?.side || 'HOLD').toUpperCase();

  if (!isAshareSymbol(symbol)) blocks.push('non_ashare_symbol');

  if (side === 'BUY' || side === 'SELL') {
    const lotCheck = ensureLotSize(decision?.qty, 100);
    if (!lotCheck.ok) blocks.push(lotCheck.reason);
  }

  if (side === 'BUY' && pendingPositions >= maxPositionCount) blocks.push('position_cap');
  if (side === 'SELL' && t1Locked) blocks.push('t1_locked');
  if (side === 'SELL' && Number(currentPositionQty || 0) <= 0) blocks.push('no_position');
  if (side === 'SELL' && Number(decision?.qty || 0) > Number(currentPositionQty || 0)) blocks.push('sell_qty_exceeds_position');
  if (Number(decision?.confidence ?? 0) < 0.55 && side !== 'HOLD') blocks.push('low_confidence');

  const approvedForBridge = blocks.length === 0;
  return {
    approvedForBridge,
    forceManualApproval,
    estimatedRisk: {
      maxDailyLossPct,
      confidence: Number(decision?.confidence ?? 0)
    },
    normalized: {
      ...decision,
      symbol,
      side
    },
    blocks
  };
}
