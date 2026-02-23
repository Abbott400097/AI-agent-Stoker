import fs from 'node:fs';
import path from 'node:path';
import { defaultPortfolioLedger } from './lib/portfolio_ledger.mjs';

const RUNTIME_DIR = path.resolve('.runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json');

const defaultState = () => ({
  workflows: [],
  decisions: [],
  approvals: [],
  receipts: [],
  messages: [],
  portfolio: defaultPortfolioLedger(),
  config: {
    brokerMode: 'eastmoney-bridge',
    bridgeEndpoint: 'http://127.0.0.1:8099/eastmoney-sim/order',
    bridgeSimulate: true,
    manualApproval: true,
    maxDailyLossPct: 2,
    maxPositionCount: 4,
    defaultUniverse: ['600519.SH', '601318.SH', '600036.SH', '600276.SH', '601899.SH'],
    discord: {
      enabled: true,
      applicationId: '',
      guildId: '',
      interactionsPath: '/webhooks/discord/interactions'
    },
    openclaw: {
      enabled: true,
      webhookPath: '/webhooks/openclaw',
      authEnabled: false
    }
  }
});

function ensureDir() {
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

export function loadState() {
  ensureDir();
  if (!fs.existsSync(STATE_FILE)) {
    const state = defaultState();
    saveState(state);
    return state;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      config: {
        ...defaultState().config,
        ...(parsed.config || {}),
        discord: { ...defaultState().config.discord, ...(parsed.config?.discord || {}) },
        openclaw: { ...defaultState().config.openclaw, ...(parsed.config?.openclaw || {}) }
      },
      portfolio: { ...defaultPortfolioLedger(), ...(parsed.portfolio || {}) }
    };
  } catch {
    const state = defaultState();
    saveState(state);
    return state;
  }
}

export function saveState(state) {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function appendCapped(list, item, cap = 200) {
  list.unshift(item);
  if (list.length > cap) list.length = cap;
}
