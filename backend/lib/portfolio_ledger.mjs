export function defaultPortfolioLedger() {
  return {
    cash: 100000,
    positions: {},
    trades: [],
    lastMark: {},
    equityHistory: []
  };
}

export function getPortfolioSnapshot(ledger) {
  const positions = Object.entries(ledger?.positions || {}).map(([symbol, pos]) => ({
    symbol,
    qty: pos.qty,
    avgCost: pos.avgCost,
    lastBuyDate: pos.lastBuyDate || null,
    markPrice: ledger?.lastMark?.[symbol] ?? pos.avgCost,
    unrealizedPnl: round2((Number(ledger?.lastMark?.[symbol] ?? pos.avgCost) - pos.avgCost) * pos.qty)
  }));

  const marketValue = positions.reduce((sum, p) => sum + p.qty * (p.markPrice || p.avgCost), 0);
  return {
    cash: round2(ledger?.cash ?? 0),
    positions,
    positionCount: positions.filter((p) => p.qty > 0).length,
    marketValue: round2(marketValue),
    equity: round2((ledger?.cash ?? 0) + marketValue),
    recentTrades: (ledger?.trades || []).slice(0, 20)
  };
}

export function applyReceiptToPortfolio({ ledger, decision, receipt, tradeDate }) {
  if (!ledger || !decision || !receipt?.accepted) {
    return { updated: false, reason: 'receipt_not_accepted' };
  }

  const symbol = decision.symbol;
  const side = String(decision.side || '').toUpperCase();
  const qty = Number(decision.qty || 0);
  const price = Number(decision.limitPrice || 0);
  if (!symbol || !qty || !price) return { updated: false, reason: 'invalid_trade_fields' };

  ledger.positions ||= {};
  ledger.trades ||= [];
  ledger.lastMark ||= {};
  ledger.equityHistory ||= [];

  if (side === 'BUY') {
    const cost = round2(qty * price);
    if ((ledger.cash ?? 0) < cost) return { updated: false, reason: 'cash_insufficient' };
    const pos = ledger.positions[symbol] || { qty: 0, avgCost: 0, lastBuyDate: null };
    const nextQty = pos.qty + qty;
    const nextAvg = nextQty > 0 ? round2((pos.avgCost * pos.qty + cost) / nextQty) : 0;
    ledger.positions[symbol] = {
      qty: nextQty,
      avgCost: nextAvg,
      lastBuyDate: tradeDate || todayYmd(),
      lastActionDate: tradeDate || todayYmd()
    };
    ledger.cash = round2((ledger.cash ?? 0) - cost);
    ledger.lastMark[symbol] = price;
    ledger.trades.unshift({ id: cryptoRandomId(), symbol, side, qty, price, ts: new Date().toISOString(), tradeDate: tradeDate || todayYmd(), receiptId: receipt.id, realizedPnl: 0 });
  } else if (side === 'SELL') {
    const pos = ledger.positions[symbol];
    if (!pos || pos.qty < qty) return { updated: false, reason: 'position_insufficient' };
    const proceeds = round2(qty * price);
    const realizedPnl = round2((price - pos.avgCost) * qty);
    const remaining = pos.qty - qty;
    ledger.cash = round2((ledger.cash ?? 0) + proceeds);
    ledger.lastMark[symbol] = price;
    if (remaining <= 0) {
      delete ledger.positions[symbol];
    } else {
      ledger.positions[symbol] = { ...pos, qty: remaining, lastActionDate: tradeDate || todayYmd() };
    }
    ledger.trades.unshift({ id: cryptoRandomId(), symbol, side, qty, price, ts: new Date().toISOString(), tradeDate: tradeDate || todayYmd(), receiptId: receipt.id, realizedPnl });
  } else {
    return { updated: false, reason: 'unsupported_side' };
  }

  if (ledger.trades.length > 500) ledger.trades.length = 500;
  const snap = getPortfolioSnapshot(ledger);
  ledger.equityHistory.unshift({ ts: new Date().toISOString(), equity: snap.equity, cash: snap.cash, marketValue: snap.marketValue });
  if (ledger.equityHistory.length > 500) ledger.equityHistory.length = 500;

  return { updated: true, snapshot: snap };
}

export function isT1Locked(ledger, symbol, tradeDate) {
  const pos = ledger?.positions?.[symbol];
  if (!pos?.lastBuyDate) return false;
  const d = tradeDate || todayYmd();
  return pos.lastBuyDate === d;
}

export function positionQty(ledger, symbol) {
  return Number(ledger?.positions?.[symbol]?.qty || 0);
}

export function markSymbolPrice(ledger, symbol, price) {
  ledger.lastMark ||= {};
  if (Number.isFinite(Number(price))) ledger.lastMark[symbol] = Number(price);
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

function cryptoRandomId() {
  return globalThis.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
