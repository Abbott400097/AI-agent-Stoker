import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const VENDOR_ROOT = path.resolve('vendors/TradingAgents');
const PY_PROXY = path.resolve('backend/scripts/tradingagents_proxy.py');
const LOCAL_VENV_PY = path.resolve('.venv/bin/python3');

export async function getTradingAgentsInsights({ symbol, mode, market }) {
  const adapterMode = (process.env.TRADINGAGENTS_ADAPTER_MODE || 'fallback').toLowerCase();

  if (adapterMode === 'fallback') {
    return fallbackInsights({ symbol, mode, market, reason: 'adapter_mode=fallback' });
  }

  if (!fs.existsSync(VENDOR_ROOT)) {
    return fallbackInsights({ symbol, mode, market, reason: 'vendors/TradingAgents not found' });
  }

  if (!fs.existsSync(PY_PROXY)) {
    return fallbackInsights({ symbol, mode, market, reason: 'proxy script missing' });
  }

  if (adapterMode === 'python-proxy') {
    try {
      const result = await execPythonProxy({ symbol, mode, market });
      if (result?.ok) return result;
      return fallbackInsights({ symbol, mode, market, reason: result?.error || 'proxy_failed' });
    } catch (error) {
      return fallbackInsights({ symbol, mode, market, reason: `proxy_exception:${error.message}` });
    }
  }

  return fallbackInsights({ symbol, mode, market, reason: `unknown_mode:${adapterMode}` });
}

function fallbackInsights({ symbol, mode, market, reason }) {
  return {
    ok: false,
    source: 'fallback',
    reason,
    analysts: {
      market: { score: clamp(0.45 + (market.sentiment - 0.5) * 0.7, 0, 1), summary: 'fallback market analyst' },
      news: { score: clamp(0.5 + (Math.random() - 0.5) * 0.24, 0, 1), summary: 'fallback news analyst' },
      fundamentals: { score: clamp(0.48 + (Math.random() - 0.5) * 0.18, 0, 1), summary: 'fallback fundamentals analyst' },
      social: { score: clamp(0.5 + (market.turnoverHeat - 0.5) * 0.4, 0, 1), summary: 'fallback social analyst' }
    },
    debate: {
      bull: clamp(0.4 + market.sentiment * 0.35 + market.turnoverHeat * 0.2, 0, 1),
      bear: clamp(0.35 + (1 - market.sentiment) * 0.35, 0, 1)
    },
    trader: {
      actionBias: mode === 'trend' ? 'trend' : mode === 'pullback' ? 'pullback' : 'hybrid',
      summary: `TradingAgents adapter fallback (${reason})`
    },
    metadata: {
      symbol,
      mode,
      tradeDate: new Date().toISOString().slice(0, 10)
    }
  };
}

async function execPythonProxy(payload) {
  return new Promise((resolve) => {
    const pythonBin = fs.existsSync(LOCAL_VENV_PY) ? LOCAL_VENV_PY : 'python3';
    const proc = spawn(pythonBin, [PY_PROXY], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1'
      }
    });

    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', (e) => resolve({ ok: false, error: e.message }));
    proc.on('close', (code) => {
      if (code !== 0) return resolve({ ok: false, error: `proxy_exit_${code}:${err.trim()}` });
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({ ok: false, error: `bad_proxy_json:${out.slice(0, 200)}` });
      }
    });
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
