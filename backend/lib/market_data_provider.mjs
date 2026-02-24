import { normalizeAshareSymbol } from './a_share_rules.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_SYMBOLS = {
  '600519.SH': { name: '贵州茅台', sector: '消费' },
  '601318.SH': { name: '中国平安', sector: '金融' },
  '600036.SH': { name: '招商银行', sector: '金融' },
  '600276.SH': { name: '恒瑞医药', sector: '医药' },
  '601899.SH': { name: '紫金矿业', sector: '资源' },
  '300750.SZ': { name: '宁德时代', sector: '新能源' }
};

export async function getMarketSnapshot({ symbol, mode = 'hybrid', config = {} }) {
  symbol = normalizeAshareSymbol(symbol);
  const providerCfg = { ...(config.marketData || {}) };
  const providerMode = String(providerCfg.provider || process.env.MARKET_DATA_PROVIDER || 'mock').toLowerCase();

  if (providerMode === 'akshare-proxy') {
    const res = await execAkshareProxy({ symbol, mode });
    if (res?.ok && res.snapshot) {
      return {
        ...res.snapshot,
        source: res.snapshot.source || res.source || 'akshare-proxy'
      };
    }
  }

  if (providerMode === 'http-json') {
    const res = await tryHttpJsonProvider({ symbol, mode, providerCfg });
    if (res?.ok) return res.snapshot;
  }

  return synthesizeMarket(symbol, mode);
}

async function execAkshareProxy(payload) {
  const script = path.resolve('backend/scripts/market_data_proxy.py');
  const py = fs.existsSync(path.resolve('.venv/bin/python3')) ? path.resolve('.venv/bin/python3') : 'python3';
  if (!fs.existsSync(script)) return { ok: false, error: 'market_data_proxy_missing' };

  return new Promise((resolve) => {
    const timeoutMs = Number(process.env.MARKET_DATA_PROXY_TIMEOUT_MS || 12000);
    const proc = spawn(py, [script], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1'
      }
    });
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      resolve({ ok: false, error: `market_proxy_timeout_${timeoutMs}ms` });
    }, timeoutMs);

    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `spawn_error:${e.message}` });
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, error: `proxy_exit_${code}:${err.trim().slice(0, 240)}` });
      try {
        const body = JSON.parse(out);
        if (body?.ok) return resolve(body);
        return resolve({ ok: false, error: body?.error || 'market_proxy_failed' });
      } catch {
        return resolve({ ok: false, error: `market_proxy_bad_json:${out.slice(0, 200)}` });
      }
    });

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

async function tryHttpJsonProvider({ symbol, mode, providerCfg }) {
  const baseUrl = providerCfg.baseUrl || process.env.MARKET_DATA_BASE_URL || '';
  if (!baseUrl) return { ok: false, error: 'no_market_data_base_url' };

  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/snapshot?symbol=${encodeURIComponent(symbol)}&mode=${encodeURIComponent(mode)}`;
  try {
    const headers = {};
    const token = providerCfg.apiKey || process.env.MARKET_DATA_API_KEY || '';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(endpoint, { headers });
    if (!response.ok) return { ok: false, error: `http_${response.status}` };
    const body = await response.json();
    const snapshot = normalizeExternalSnapshot(body, symbol);
    if (!snapshot) return { ok: false, error: 'bad_snapshot_shape' };
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, error: `provider_error:${error.message}` };
  }
}

function normalizeExternalSnapshot(body, symbol) {
  const lastPrice = Number(body?.lastPrice ?? body?.price);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;

  const candles = Array.isArray(body?.candles)
    ? body.candles.map((c) => ({
        ts: c.ts || c.time || null,
        open: n(c.open),
        high: n(c.high),
        low: n(c.low),
        close: n(c.close),
        volume: n(c.volume ?? c.vol)
      })).filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v)))
    : [];

  const dayChangePct = Number(body?.dayChangePct ?? body?.changePct ?? 0);
  const turnoverHeat = clamp(Number(body?.turnoverHeat ?? body?.liquidityScore ?? 0.5), 0, 1);
  const sentiment = clamp(Number(body?.sentiment ?? 0.5), 0, 1);
  const sectorHeat = clamp(Number(body?.sectorHeat ?? 0.5), 0, 1);

  return {
    symbol,
    ...(DEFAULT_SYMBOLS[symbol] || {}),
    lastPrice: round2(lastPrice),
    dayChangePct: round2(dayChangePct),
    turnoverHeat: round2(turnoverHeat),
    sentiment: round2(sentiment),
    sectorHeat: round2(sectorHeat),
    regime: body?.regime || (sentiment > 0.65 ? 'risk-on' : sentiment < 0.35 ? 'risk-off' : 'range'),
    source: 'http-json',
    asOf: body?.asOf || new Date().toISOString(),
    candles
  };
}

function synthesizeMarket(symbol, mode) {
  const base = 80 + Math.random() * 1800;
  const trend = (Math.random() - 0.5) * (mode === 'trend' ? 0.08 : mode === 'pullback' ? 0.05 : 0.07);
  const intraday = (Math.random() - 0.5) * 0.04;
  const lastPrice = round2(base * (1 + trend + intraday));
  const dayChangePct = round2((trend + intraday) * 100);
  const turnoverHeat = clamp(0.25 + Math.random() * 0.65, 0, 1);
  const sentiment = clamp(0.2 + Math.random() * 0.7 + dayChangePct / 30, 0, 1);
  const sectorHeat = clamp(0.2 + Math.random() * 0.75, 0, 1);
  const candles = synthesizeCandles(lastPrice, dayChangePct);

  return {
    symbol,
    ...(DEFAULT_SYMBOLS[symbol] || {}),
    lastPrice,
    dayChangePct,
    turnoverHeat: round2(turnoverHeat),
    sentiment: round2(sentiment),
    sectorHeat: round2(sectorHeat),
    regime: sentiment > 0.65 ? 'risk-on' : sentiment < 0.35 ? 'risk-off' : 'range',
    source: 'mock',
    asOf: new Date().toISOString(),
    candles
  };
}

function synthesizeCandles(lastPrice, dayChangePct) {
  const count = 60;
  const candles = [];
  let px = lastPrice / (1 + dayChangePct / 100);
  for (let i = 0; i < count; i++) {
    const drift = (lastPrice - px) / Math.max(1, count - i) * 0.6;
    const noise = (Math.random() - 0.5) * lastPrice * 0.003;
    const open = px;
    const close = Math.max(0.01, px + drift + noise);
    const high = Math.max(open, close) * (1 + Math.random() * 0.0015);
    const low = Math.min(open, close) * (1 - Math.random() * 0.0015);
    const volume = Math.round(5000 + Math.random() * 15000 + i * 20);
    candles.push({
      ts: new Date(Date.now() - (count - i) * 60_000).toISOString(),
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume
    });
    px = close;
  }
  return candles;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}
