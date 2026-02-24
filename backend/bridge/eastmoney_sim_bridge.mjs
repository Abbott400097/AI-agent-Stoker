import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.BRIDGE_PORT || 8099);
const RUNTIME_DIR = path.resolve('.runtime');
const LOG_FILE = path.join(RUNTIME_DIR, 'eastmoney_bridge_receipts.jsonl');

ensureRuntime();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { ok: true, service: 'eastmoney-sim-bridge', now: new Date().toISOString() });
    }

    if (req.method === 'POST' && req.url === '/eastmoney-sim/order') {
      const body = await readJson(req);
      const receipt = evaluateAndSimulate(body);
      appendJsonl(LOG_FILE, receipt);
      return json(res, 200, receipt);
    }
    if (req.method === 'POST' && req.url === '/broker/order') {
      const body = await readJson(req);
      const receipt = evaluateAndSimulate(body);
      appendJsonl(LOG_FILE, receipt);
      return json(res, 200, receipt);
    }

    if (req.method === 'GET' && req.url === '/eastmoney-sim/receipts') {
      const receipts = readTailJsonl(LOG_FILE, 50);
      return json(res, 200, receipts);
    }

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    return json(res, 500, { error: 'internal_error', message: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`eastmoney sim bridge listening on http://${HOST}:${PORT}`);
});

function evaluateAndSimulate(payload) {
  const order = payload?.orderIntent || payload?.order || {};
  const symbol = String(order.symbol || '').toUpperCase();
  const side = String(order.side || '').toUpperCase();
  const qty = Number(order.qty || 0);
  const limitPrice = Number(order.limitPrice || order.suggestedPrice || 0);
  const orderId = String(payload?.orderId || `ord_${Date.now()}`);
  const brokerProfile = String(payload?.brokerProfile || payload?.broker || 'eastmoney-sim');

  const reasons = [];
  if (!symbol) reasons.push('missing_symbol');
  if (!['BUY', 'SELL'].includes(side)) reasons.push('unsupported_side');
  if (!Number.isFinite(qty) || qty <= 0) reasons.push('invalid_qty');
  if (qty % 100 !== 0) reasons.push('not_lot_size');
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) reasons.push('invalid_price');

  const randomReject = Math.random() < Number(process.env.BRIDGE_RANDOM_REJECT_PCT || 0.05);
  if (randomReject) reasons.push('simulated_reject');

  const accepted = reasons.length === 0;
  const fillPrice = accepted ? round2(limitPrice * (1 + (side === 'BUY' ? 1 : -1) * 0.0008 + (Math.random() - 0.5) * 0.0015)) : null;

  return {
    accepted,
    message: accepted ? 'eastmoney sim bridge accepted' : `rejected:${reasons.join(',')}`,
    orderId,
    brokerProfile,
    brokerOrderId: accepted ? `EMSIM-${Date.now()}-${Math.floor(Math.random() * 1000)}` : null,
    symbol,
    side,
    qty,
    requestedPrice: limitPrice,
    fillPrice,
    simulated: true,
    ts: new Date().toISOString()
  };
}

function ensureRuntime() {
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function appendJsonl(file, row) {
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

function readTailJsonl(file, n) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split(/\n+/).slice(-n).reverse();
  return lines.map((line) => {
    try { return JSON.parse(line); } catch { return { parse_error: true, line }; }
  });
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}
