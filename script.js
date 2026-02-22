const STORAGE_KEY = "a_share_ai_lab_v1";

const SYMBOLS = [
  { code: "600519", name: "贵州茅台", sector: "消费" },
  { code: "000333", name: "美的集团", sector: "家电" },
  { code: "002594", name: "比亚迪", sector: "新能源车" },
  { code: "300750", name: "宁德时代", sector: "新能源" },
  { code: "601318", name: "中国平安", sector: "金融" },
  { code: "600036", name: "招商银行", sector: "金融" },
  { code: "600276", name: "恒瑞医药", sector: "医药" },
  { code: "300308", name: "中际旭创", sector: "算力" },
  { code: "603986", name: "兆易创新", sector: "半导体" },
  { code: "002415", name: "海康威视", sector: "安防" }
];

const DEFAULT_CONFIG = {
  initialCash: 300000,
  maxPositions: 4,
  riskPerTradePct: 6,
  signalThreshold: 0.57,
  strategyMode: "hybrid",
  brokerMode: "sim-approval",
  autoLearn: true,
  pushWebhooks: false,
  openclawWebhook: "",
  discordWebhook: "",
  brokerBridgeEndpoint: ""
};

const DEFAULT_WEIGHTS = {
  momentum: 0.34,
  pullback: 0.18,
  liquidity: 0.15,
  sectorHeat: 0.18,
  newsBias: 0.15
};

const els = {
  runDayBtn: document.getElementById("runDayBtn"),
  runWeekBtn: document.getElementById("runWeekBtn"),
  approveBtn: document.getElementById("approveBtn"),
  resetBtn: document.getElementById("resetBtn"),
  seedBtn: document.getElementById("seedBtn"),
  configForm: document.getElementById("configForm"),
  dayIndex: document.getElementById("dayIndex"),
  totalDays: document.getElementById("totalDays"),
  marketPhase: document.getElementById("marketPhase"),
  equityValue: document.getElementById("equityValue"),
  dayPnlText: document.getElementById("dayPnlText"),
  drawdownValue: document.getElementById("drawdownValue"),
  winRateText: document.getElementById("winRateText"),
  bridgeStatus: document.getElementById("bridgeStatus"),
  marketRegimeBadge: document.getElementById("marketRegimeBadge"),
  marketSnapshot: document.getElementById("marketSnapshot"),
  agentLog: document.getElementById("agentLog"),
  pendingCount: document.getElementById("pendingCount"),
  positionsTable: document.getElementById("positionsTable"),
  ordersTable: document.getElementById("ordersTable"),
  journalTable: document.getElementById("journalTable"),
  weightsPanel: document.getElementById("weightsPanel"),
  learningNotes: document.getElementById("learningNotes")
};

let state = loadState();
renderAll();
bindEvents();

function bindEvents() {
  els.runDayBtn.addEventListener("click", () => runDays(1));
  els.runWeekBtn.addEventListener("click", () => runDays(5));
  els.approveBtn.addEventListener("click", approvePendingOrders);
  els.resetBtn.addEventListener("click", resetSimulation);
  els.seedBtn.addEventListener("click", reseedMarket);
  els.configForm.addEventListener("submit", onSaveConfig);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return hydrateState(parsed);
    }
  } catch (error) {
    console.warn("Failed to load state", error);
  }
  return createFreshState();
}

function hydrateState(raw) {
  const fresh = createFreshState();
  const merged = {
    ...fresh,
    ...raw,
    config: { ...fresh.config, ...(raw.config || {}) },
    learning: { ...fresh.learning, ...(raw.learning || {}) },
    broker: { ...fresh.broker, ...(raw.broker || {}) },
    portfolio: { ...fresh.portfolio, ...(raw.portfolio || {}) },
    logs: { ...fresh.logs, ...(raw.logs || {}) },
    market: { ...fresh.market, ...(raw.market || {}) }
  };

  if (!Array.isArray(merged.market.days) || merged.market.days.length === 0) {
    merged.market = generateMarket(30);
    merged.market.dayIndex = 0;
  }

  if (!Array.isArray(merged.logs.messages)) merged.logs.messages = [];
  if (!Array.isArray(merged.logs.learningNotes)) merged.logs.learningNotes = [];
  if (!Array.isArray(merged.portfolio.positions)) merged.portfolio.positions = [];
  if (!Array.isArray(merged.portfolio.orders)) merged.portfolio.orders = [];
  if (!Array.isArray(merged.portfolio.closedTrades)) merged.portfolio.closedTrades = [];
  if (!Array.isArray(merged.portfolio.equityCurve)) merged.portfolio.equityCurve = [];
  if (!Array.isArray(merged.portfolio.dailySummaries)) merged.portfolio.dailySummaries = [];

  normalizeWeights(merged.learning.weights);
  return merged;
}

function createFreshState() {
  const market = generateMarket(30);
  return {
    config: { ...DEFAULT_CONFIG },
    learning: {
      weights: { ...DEFAULT_WEIGHTS },
      updates: 0,
      lastAdjustment: "尚未开始"
    },
    broker: {
      lastBridgeStatus: "未启用",
      bridgeReceipts: []
    },
    market: {
      ...market,
      dayIndex: 0
    },
    portfolio: {
      cash: DEFAULT_CONFIG.initialCash,
      positions: [],
      orders: [],
      closedTrades: [],
      equityCurve: [],
      dailySummaries: []
    },
    logs: {
      messages: [],
      learningNotes: []
    }
  };
}

function generateMarket(totalDays) {
  const basePrices = {
    "600519": 1680,
    "000333": 57,
    "002594": 215,
    "300750": 182,
    "601318": 45,
    "600036": 34,
    "600276": 42,
    "300308": 132,
    "603986": 90,
    "002415": 32
  };

  const sectorDrift = {};
  const priceMap = { ...basePrices };
  const days = [];

  for (let d = 1; d <= totalDays; d += 1) {
    const regimeStrength = Math.sin(d / 3.8) * 0.8 + (Math.random() - 0.5) * 0.9;
    const sentiment = clamp(0.5 + regimeStrength * 0.18, 0.05, 0.95);
    const turnoverHeat = clamp(0.45 + Math.cos(d / 4.7) * 0.22 + (Math.random() - 0.5) * 0.2, 0.1, 0.95);

    const sectors = [...new Set(SYMBOLS.map((s) => s.sector))];
    for (const sector of sectors) {
      const prev = sectorDrift[sector] || 0;
      sectorDrift[sector] = clamp(prev * 0.55 + (Math.random() - 0.5) * 1.6 + regimeStrength * 0.55, -2.2, 2.2);
    }

    const quotes = SYMBOLS.map((symbol, index) => {
      const prevClose = priceMap[symbol.code];
      const sectorBias = sectorDrift[symbol.sector] || 0;
      const idiosyncratic = (Math.random() - 0.5) * (1.4 + (index % 3) * 0.5);
      const gap = (Math.random() - 0.5) * 0.8 + sectorBias * 0.12;
      const dayReturnPct = clamp(gap + idiosyncratic + regimeStrength * 0.25, -8.8, 8.8);
      const open = round2(prevClose * (1 + gap / 100));
      const close = round2(prevClose * (1 + dayReturnPct / 100));
      const intradayRangePct = Math.abs(dayReturnPct) * 0.9 + 0.7 + Math.random() * 2.6;
      const high = round2(Math.max(open, close) * (1 + intradayRangePct / 200));
      const low = round2(Math.min(open, close) * (1 - intradayRangePct / 210));
      const volumeRatio = clamp(0.7 + turnoverHeat * 0.8 + Math.abs(dayReturnPct) * 0.05 + Math.random() * 0.6, 0.5, 3.8);
      const newsScore = clamp((Math.random() - 0.5) * 1.2 + sectorBias * 0.18, -1, 1);
      const limitTag = Math.abs(dayReturnPct) > 8.5 ? (dayReturnPct > 0 ? "near-up-limit" : "near-down-limit") : "none";

      priceMap[symbol.code] = close;

      return {
        ...symbol,
        open,
        high,
        low,
        close,
        prevClose,
        returnPct: round2(dayReturnPct),
        volumeRatio: round2(volumeRatio),
        sectorHeat: round2(clamp(0.5 + sectorBias * 0.18, 0, 1)),
        newsScore: round2(newsScore),
        limitTag
      };
    });

    days.push({
      dayNumber: d,
      dateLabel: `D${String(d).padStart(2, "0")}`,
      regime: regimeStrength > 0.55 ? "risk-on" : regimeStrength < -0.45 ? "risk-off" : "range",
      sentiment: round2(sentiment),
      turnoverHeat: round2(turnoverHeat),
      quotes
    });
  }

  return { days };
}

function onSaveConfig(event) {
  event.preventDefault();
  const formData = new FormData(els.configForm);
  state.config.initialCash = num(formData.get("initialCash"), DEFAULT_CONFIG.initialCash);
  state.config.maxPositions = Math.max(1, num(formData.get("maxPositions"), DEFAULT_CONFIG.maxPositions));
  state.config.riskPerTradePct = clamp(num(formData.get("riskPerTradePct"), DEFAULT_CONFIG.riskPerTradePct), 0.5, 30);
  state.config.signalThreshold = clamp(num(formData.get("signalThreshold"), DEFAULT_CONFIG.signalThreshold), 0, 1);
  state.config.strategyMode = String(formData.get("strategyMode") || DEFAULT_CONFIG.strategyMode);
  state.config.brokerMode = String(formData.get("brokerMode") || DEFAULT_CONFIG.brokerMode);
  state.config.autoLearn = formData.get("autoLearn") === "on";
  state.config.pushWebhooks = formData.get("pushWebhooks") === "on";
  state.config.openclawWebhook = String(formData.get("openclawWebhook") || "").trim();
  state.config.discordWebhook = String(formData.get("discordWebhook") || "").trim();
  state.config.brokerBridgeEndpoint = String(formData.get("brokerBridgeEndpoint") || "").trim();

  if (state.portfolio.equityCurve.length === 0 && state.market.dayIndex === 0 && state.portfolio.positions.length === 0) {
    state.portfolio.cash = state.config.initialCash;
  }

  state.broker.lastBridgeStatus = brokerStatusText();
  appendSystemNote("配置已更新。后续交易日将按新参数执行。", "execution");
  persistAndRender();
}

function resetSimulation() {
  if (!window.confirm("重置后会清空当前模拟记录和自学习参数，继续吗？")) {
    return;
  }
  state = createFreshState();
  persistAndRender();
}

function reseedMarket() {
  state.market = { ...generateMarket(30), dayIndex: 0 };
  state.portfolio = {
    cash: state.config.initialCash,
    positions: [],
    orders: [],
    closedTrades: [],
    equityCurve: [],
    dailySummaries: []
  };
  state.logs = { messages: [], learningNotes: [] };
  state.learning = {
    weights: { ...DEFAULT_WEIGHTS },
    updates: 0,
    lastAdjustment: "市场样本已重建，参数回到初始状态"
  };
  state.broker = { lastBridgeStatus: brokerStatusText(), bridgeReceipts: [] };
  persistAndRender();
}

async function runDays(count) {
  for (let i = 0; i < count; i += 1) {
    if (state.market.dayIndex >= state.market.days.length) {
      appendSystemNote("样本交易日已跑完，请重建市场样本。", "review");
      persistAndRender();
      break;
    }

    await runSingleDay();

    if (state.config.brokerMode !== "sim-auto" && hasPendingOrders()) {
      appendSystemNote("存在待审批订单，暂停连跑，先审批再继续。", "risk");
      persistAndRender();
      break;
    }
  }
}

async function runSingleDay() {
  const day = state.market.days[state.market.dayIndex];
  const prevEquity = computeEquity(currentQuotesForDay(day));

  addAgentMessage("intel", `盘前扫描 ${day.dateLabel} | 市场状态 ${regimeLabel(day.regime)} | 情绪 ${pct(day.sentiment)} | 热度 ${pct(day.turnoverHeat)}。`);

  const signalCandidates = buildSignals(day);
  addAgentMessage(
    "signal",
    `输出候选 ${signalCandidates.length} 只。Top3: ${signalCandidates.slice(0, 3).map((item) => `${item.code}(${item.side}/${item.score.toFixed(2)})`).join("、") || "无"}`
  );

  const tradePlan = riskReview(day, signalCandidates);
  addAgentMessage(
    "risk",
    `风险审查完成：建议买入 ${tradePlan.buyOrders.length} 笔、卖出 ${tradePlan.sellOrders.length} 笔、阻止 ${tradePlan.blockedReasons.length} 项。${tradePlan.blockedReasons.slice(0, 2).join("；") || "无明显冲突"}`
  );

  queueOrders(day, tradePlan);
  addAgentMessage(
    "execution",
    `执行层已生成 ${tradePlan.buyOrders.length + tradePlan.sellOrders.length} 笔订单建议，模式=${state.config.brokerMode}。${hasPendingOrders() ? "等待审批/桥接回执。" : "已在模拟盘自动执行。"}`
  );

  if (state.config.brokerMode === "sim-auto") {
    await executePendingOrders({ source: "auto" });
  }

  const quotes = currentQuotesForDay(day);
  markToMarketPositions(quotes);
  const postEquity = computeEquity(quotes);
  const dayPnl = round2(postEquity - prevEquity);

  const summary = {
    dayNumber: day.dayNumber,
    dateLabel: day.dateLabel,
    regime: day.regime,
    equity: postEquity,
    dayPnl,
    pendingOrders: countPendingOrders()
  };
  state.portfolio.dailySummaries.push(summary);
  state.portfolio.equityCurve.push({ dayNumber: day.dayNumber, equity: postEquity });

  if (state.config.autoLearn) {
    runDailyLearning();
  }

  addAgentMessage(
    "review",
    `收盘复盘 ${day.dateLabel}：权益 ¥${postEquity.toFixed(2)}，当日 ${signedMoney(dayPnl)}，持仓 ${state.portfolio.positions.length}，待审批 ${countPendingOrders()}。${state.learning.lastAdjustment}`
  );

  await emitWebhooks("day_summary", {
    day: day.dateLabel,
    regime: day.regime,
    equity: postEquity,
    dayPnl,
    pendingOrders: countPendingOrders(),
    topSignals: signalCandidates.slice(0, 5)
  });

  state.market.dayIndex += 1;
  state.broker.lastBridgeStatus = brokerStatusText();
  persistAndRender();
}

function currentQuotesForDay(day) {
  return Object.fromEntries(day.quotes.map((q) => [q.code, q]));
}

function buildSignals(day) {
  const quotes = day.quotes;
  const weights = state.learning.weights;
  const strategyMode = state.config.strategyMode;

  const enriched = quotes.map((quote) => {
    const history = getHistoryForSymbol(quote.code, state.market.dayIndex + 1);
    const momentum3 = history.length >= 3 ? (quote.close - history[history.length - 3].close) / history[history.length - 3].close : 0;
    const momentum5 = history.length >= 5 ? (quote.close - history[history.length - 5].close) / history[history.length - 5].close : momentum3;
    const momentum = clamp(0.5 + momentum3 * 4.2 + momentum5 * 2.2, 0, 1);
    const pullback = clamp(0.5 + ((quote.high - quote.close) / Math.max(quote.close, 0.01)) * 3.2 - momentum3 * 2.8, 0, 1);
    const liquidity = clamp((quote.volumeRatio - 0.7) / 2.6, 0, 1);
    const sectorHeat = clamp(quote.sectorHeat, 0, 1);
    const newsBias = clamp((quote.newsScore + 1) / 2, 0, 1);

    let score =
      momentum * weights.momentum +
      pullback * weights.pullback +
      liquidity * weights.liquidity +
      sectorHeat * weights.sectorHeat +
      newsBias * weights.newsBias;

    if (strategyMode === "trend") {
      score += (momentum - pullback) * 0.14;
    }
    if (strategyMode === "pullback") {
      score += (pullback - momentum * 0.6) * 0.14;
    }
    if (strategyMode === "hybrid") {
      score += (liquidity + sectorHeat - 1) * 0.05;
    }

    score = clamp(score, 0, 1);

    const side = score >= state.config.signalThreshold ? "BUY" : momentum < 0.35 && quote.newsScore < -0.25 ? "SELL_REDUCE" : "WATCH";
    return {
      ...quote,
      score,
      side,
      factors: { momentum, pullback, liquidity, sectorHeat, newsBias },
      momentum3: round2(momentum3 * 100),
      momentum5: round2(momentum5 * 100)
    };
  });

  return enriched.sort((a, b) => b.score - a.score);
}

function riskReview(day, candidates) {
  const positions = state.portfolio.positions;
  const quotes = currentQuotesForDay(day);
  const blockedReasons = [];
  const buyOrders = [];
  const sellOrders = [];
  const heldCodes = new Set(positions.map((p) => p.code));

  for (const pos of positions) {
    const quote = quotes[pos.code];
    if (!quote) continue;
    const pnlPct = (quote.close - pos.avgCost) / pos.avgCost;
    const t1Locked = pos.lastBuyDay === day.dayNumber;
    const hitStop = pnlPct <= -0.065;
    const takeProfit = pnlPct >= 0.1 && quote.returnPct < 0;
    const weakSignal = candidates.find((c) => c.code === pos.code)?.score < 0.4;

    if ((hitStop || takeProfit || weakSignal) && !t1Locked) {
      sellOrders.push({
        code: pos.code,
        name: pos.name,
        side: "SELL",
        qty: pos.qty,
        refPrice: quote.close,
        reason: hitStop ? "止损触发" : takeProfit ? "止盈保护" : "信号转弱",
        riskTag: hitStop ? "hard-stop" : "signal-exit"
      });
    } else if ((hitStop || takeProfit) && t1Locked) {
      blockedReasons.push(`${pos.code} 触发卖出信号但受 T+1 限制`);
    }
  }

  const availableSlots = Math.max(0, state.config.maxPositions - positions.length - sellOrders.length + countReducingToZero(sellOrders, positions));
  if (availableSlots <= 0) {
    blockedReasons.push("持仓已达上限，暂停新增仓位");
  }

  const tradableBuys = candidates.filter((c) => c.side === "BUY" && !heldCodes.has(c.code));
  let slotsLeft = availableSlots;
  for (const candidate of tradableBuys) {
    if (slotsLeft <= 0) break;
    if (candidate.limitTag === "near-up-limit") {
      blockedReasons.push(`${candidate.code} 接近涨停，避免追高`);
      continue;
    }
    const allocation = state.portfolio.cash * (state.config.riskPerTradePct / 100);
    const qty = Math.floor(allocation / Math.max(candidate.close, 0.01) / 100) * 100;
    if (qty <= 0) {
      blockedReasons.push(`${candidate.code} 资金不足以买入一手`);
      continue;
    }
    buyOrders.push({
      code: candidate.code,
      name: candidate.name,
      side: "BUY",
      qty,
      refPrice: candidate.close,
      reason: `评分 ${candidate.score.toFixed(2)} | 板块热度 ${candidate.sectorHeat.toFixed(2)} | 量比 ${candidate.volumeRatio}`,
      riskTag: "signal-entry",
      factors: candidate.factors
    });
    slotsLeft -= 1;
  }

  return { buyOrders, sellOrders, blockedReasons };
}

function countReducingToZero(sellOrders, positions) {
  let count = 0;
  for (const order of sellOrders) {
    const pos = positions.find((p) => p.code === order.code);
    if (pos && order.qty >= pos.qty) count += 1;
  }
  return count;
}

function queueOrders(day, tradePlan) {
  const toQueue = [...tradePlan.sellOrders, ...tradePlan.buyOrders].map((order) => ({
    id: cryptoRandomId(),
    dayNumber: day.dayNumber,
    dateLabel: day.dateLabel,
    status: state.config.brokerMode === "sim-auto" ? "queued" : "pending_approval",
    brokerMode: state.config.brokerMode,
    ...order
  }));

  state.portfolio.orders.unshift(...toQueue);
}

function hasPendingOrders() {
  return state.portfolio.orders.some((o) => o.status === "pending_approval" || o.status === "queued");
}

function countPendingOrders() {
  return state.portfolio.orders.filter((o) => o.status === "pending_approval" || o.status === "queued").length;
}

function approvePendingOrders() {
  if (!hasPendingOrders()) {
    appendSystemNote("当前没有待审批订单。", "execution");
    persistAndRender();
    return;
  }
  executePendingOrders({ source: "manual-approval" })
    .then(() => {
      addAgentMessage("execution", "审批流程完成，已尝试执行所有待处理订单。请查看回执与成交日志。");
      persistAndRender();
    })
    .catch((error) => {
      addAgentMessage("execution", `审批执行失败：${error.message}`);
      persistAndRender();
    });
}

async function executePendingOrders({ source }) {
  const pending = state.portfolio.orders.filter((o) => o.status === "pending_approval" || o.status === "queued");
  if (pending.length === 0) return;

  const currentDay = state.market.days[Math.min(state.market.dayIndex, state.market.days.length - 1)] || state.market.days[state.market.dayIndex - 1];
  const quotes = currentDay ? currentQuotesForDay(currentDay) : {};

  for (const order of pending) {
    const quote = quotes[order.code];
    const execPrice = quote ? slipPrice(order.side, quote.close) : order.refPrice;

    if (order.brokerMode === "eastmoney-bridge") {
      const receipt = await sendToBridge(order, execPrice, source);
      state.broker.bridgeReceipts.unshift(receipt);
      state.broker.lastBridgeStatus = receipt.statusText;
      if (!receipt.accepted) {
        order.status = "bridge_rejected";
        order.note = receipt.statusText;
        continue;
      }
    }

    const filled = applySimulatedFill(order, execPrice, currentDay?.dayNumber || order.dayNumber);
    order.status = filled ? "filled" : "rejected";
    order.fillPrice = execPrice;
    order.filledAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    order.note = filled ? `${source} | 模拟成交` : "资金/持仓不足";
  }
}

function applySimulatedFill(order, price, dayNumber) {
  if (order.side === "BUY") {
    const cost = round2(order.qty * price);
    if (state.portfolio.cash < cost) return false;
    state.portfolio.cash = round2(state.portfolio.cash - cost);

    const existing = state.portfolio.positions.find((p) => p.code === order.code);
    if (existing) {
      const totalCost = existing.avgCost * existing.qty + cost;
      existing.qty += order.qty;
      existing.avgCost = round2(totalCost / existing.qty);
      existing.lastBuyDay = dayNumber;
      existing.lastSignalFactors = order.factors || existing.lastSignalFactors;
    } else {
      state.portfolio.positions.push({
        code: order.code,
        name: order.name,
        qty: order.qty,
        avgCost: price,
        markPrice: price,
        pnl: 0,
        pnlPct: 0,
        lastBuyDay: dayNumber,
        lastSignalFactors: order.factors || { ...DEFAULT_WEIGHTS }
      });
    }
    return true;
  }

  if (order.side === "SELL") {
    const existing = state.portfolio.positions.find((p) => p.code === order.code);
    if (!existing || existing.qty < order.qty) return false;

    const proceeds = round2(order.qty * price);
    state.portfolio.cash = round2(state.portfolio.cash + proceeds);
    const pnl = round2((price - existing.avgCost) * order.qty);
    const pnlPct = round2(((price - existing.avgCost) / existing.avgCost) * 100);

    state.portfolio.closedTrades.unshift({
      id: cryptoRandomId(),
      dayNumber,
      code: existing.code,
      name: existing.name,
      qty: order.qty,
      buyCost: existing.avgCost,
      sellPrice: price,
      pnl,
      pnlPct,
      reason: order.reason,
      factors: existing.lastSignalFactors || { ...DEFAULT_WEIGHTS }
    });

    existing.qty -= order.qty;
    if (existing.qty === 0) {
      state.portfolio.positions = state.portfolio.positions.filter((p) => p.code !== existing.code);
    }
    return true;
  }

  return false;
}

function markToMarketPositions(quotes) {
  for (const pos of state.portfolio.positions) {
    const quote = quotes[pos.code];
    if (!quote) continue;
    pos.markPrice = quote.close;
    pos.pnl = round2((quote.close - pos.avgCost) * pos.qty);
    pos.pnlPct = round2(((quote.close - pos.avgCost) / pos.avgCost) * 100);
  }
}

function computeEquity(quotes) {
  let equity = state.portfolio.cash;
  for (const pos of state.portfolio.positions) {
    const mark = quotes[pos.code]?.close ?? pos.markPrice ?? pos.avgCost;
    equity += pos.qty * mark;
  }
  return round2(equity);
}

function runDailyLearning() {
  const recentClosed = state.portfolio.closedTrades.slice(0, 6);
  if (recentClosed.length === 0) {
    state.learning.lastAdjustment = "暂无已平仓样本，自学习跳过";
    return;
  }

  let changed = false;
  for (const trade of recentClosed.slice(0, 3)) {
    const reward = clamp(trade.pnlPct / 12, -1, 1);
    if (Math.abs(reward) < 0.01) continue;
    for (const key of Object.keys(state.learning.weights)) {
      const factorVal = clamp(trade.factors?.[key] ?? 0.5, 0, 1);
      const delta = reward * (factorVal - 0.45) * 0.02;
      state.learning.weights[key] = clamp(state.learning.weights[key] + delta, 0.05, 0.65);
      changed = true;
    }
  }

  if (changed) {
    normalizeWeights(state.learning.weights);
    state.learning.updates += 1;
    const winners = recentClosed.filter((t) => t.pnl > 0).length;
    const losers = recentClosed.length - winners;
    const avgPnl = recentClosed.reduce((sum, t) => sum + t.pnlPct, 0) / recentClosed.length;

    if (avgPnl < -1.5) {
      state.config.signalThreshold = clamp(state.config.signalThreshold + 0.01, 0.45, 0.8);
    } else if (avgPnl > 1.8) {
      state.config.signalThreshold = clamp(state.config.signalThreshold - 0.005, 0.42, 0.8);
    }

    state.learning.lastAdjustment = `自学习第 ${state.learning.updates} 次：近 ${recentClosed.length} 笔 ${winners} 胜 ${losers} 负，均值 ${avgPnl.toFixed(2)}%，阈值 ${state.config.signalThreshold.toFixed(2)}`;
    state.logs.learningNotes.unshift(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${state.learning.lastAdjustment}`);
    state.logs.learningNotes = state.logs.learningNotes.slice(0, 16);
  } else {
    state.learning.lastAdjustment = "自学习未触发显著调整";
  }
}

async function sendToBridge(order, execPrice, source) {
  const endpoint = state.config.brokerBridgeEndpoint;
  if (!endpoint) {
    return {
      accepted: false,
      statusText: "桥接端点未配置",
      provider: "eastmoney-bridge",
      orderId: order.id
    };
  }

  const payload = {
    orderId: order.id,
    broker: "eastmoney-sim",
    source,
    order: {
      code: order.code,
      name: order.name,
      side: order.side,
      qty: order.qty,
      refPrice: order.refPrice,
      suggestedPrice: execPrice,
      reason: order.reason,
      riskTag: order.riskTag,
      dateLabel: order.dateLabel
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return {
        accepted: false,
        statusText: `桥接 HTTP ${response.status}`,
        provider: "eastmoney-bridge",
        orderId: order.id
      };
    }

    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }

    return {
      accepted: body.accepted !== false,
      statusText: body.message || "桥接已受理",
      provider: "eastmoney-bridge",
      orderId: order.id,
      raw: body
    };
  } catch (error) {
    return {
      accepted: false,
      statusText: `桥接失败: ${error.message}`,
      provider: "eastmoney-bridge",
      orderId: order.id
    };
  }
}

async function emitWebhooks(eventType, payload) {
  if (!state.config.pushWebhooks) return;

  const tasks = [];
  if (state.config.openclawWebhook) {
    tasks.push(postJson(state.config.openclawWebhook, {
      eventType,
      project: "a-share-ai-lab",
      ts: new Date().toISOString(),
      payload
    }));
  }

  if (state.config.discordWebhook) {
    tasks.push(postJson(state.config.discordWebhook, {
      content: `【${eventType}】${payload.day || ""} 权益: ¥${(payload.equity || 0).toFixed(2)} | 当日: ${signedMoney(payload.dayPnl || 0)}`
    }));
  }

  if (tasks.length === 0) return;

  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    state.broker.lastBridgeStatus = `Webhook 部分失败 (${failed}/${results.length})`;
  }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function addAgentMessage(role, text) {
  state.logs.messages.unshift({
    id: cryptoRandomId(),
    role,
    text,
    day: state.market.days[state.market.dayIndex]?.dateLabel || "-",
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false })
  });
  state.logs.messages = state.logs.messages.slice(0, 60);
}

function appendSystemNote(text, role = "review") {
  addAgentMessage(role, text);
}

function renderAll() {
  syncFormFromState();
  renderMetrics();
  renderMarketSnapshot();
  renderAgentLog();
  renderPositions();
  renderOrders();
  renderJournal();
  renderWeights();
}

function syncFormFromState() {
  const f = els.configForm.elements;
  f.initialCash.value = state.config.initialCash;
  f.maxPositions.value = state.config.maxPositions;
  f.riskPerTradePct.value = state.config.riskPerTradePct;
  f.signalThreshold.value = state.config.signalThreshold;
  f.strategyMode.value = state.config.strategyMode;
  f.brokerMode.value = state.config.brokerMode;
  f.autoLearn.checked = state.config.autoLearn;
  f.pushWebhooks.checked = state.config.pushWebhooks;
  f.openclawWebhook.value = state.config.openclawWebhook;
  f.discordWebhook.value = state.config.discordWebhook;
  f.brokerBridgeEndpoint.value = state.config.brokerBridgeEndpoint;
}

function renderMetrics() {
  const totalDays = state.market.days.length;
  const dayIndex = state.market.dayIndex;
  const day = state.market.days[Math.min(Math.max(dayIndex - 1, 0), totalDays - 1)];
  const currentDisplayDay = state.market.days[Math.min(dayIndex, totalDays - 1)];
  const equity =
    state.portfolio.equityCurve.length > 0
      ? state.portfolio.equityCurve[state.portfolio.equityCurve.length - 1].equity
      : round2(
          state.portfolio.cash +
            state.portfolio.positions.reduce(
              (sum, pos) => sum + pos.qty * (pos.markPrice ?? pos.avgCost),
              0
            )
        );
  const recentSummary = state.portfolio.dailySummaries[state.portfolio.dailySummaries.length - 1];

  els.dayIndex.textContent = String(dayIndex);
  els.totalDays.textContent = String(totalDays);
  els.marketPhase.textContent = dayIndex >= totalDays ? "样本已结束" : `下一交易日：${currentDisplayDay?.dateLabel || "-"}`;
  els.equityValue.textContent = equity.toFixed(2);
  els.dayPnlText.textContent = `当日盈亏 ${recentSummary ? signedMoney(recentSummary.dayPnl) : "¥0.00"}`;
  els.dayPnlText.className = `muted ${(recentSummary?.dayPnl || 0) > 0 ? "text-good" : (recentSummary?.dayPnl || 0) < 0 ? "text-bad" : ""}`;

  const equityCurve = state.portfolio.equityCurve;
  const peak = equityCurve.reduce((max, point) => Math.max(max, point.equity), state.config.initialCash);
  const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  els.drawdownValue.textContent = `${drawdown.toFixed(2)}%`;

  const closed = state.portfolio.closedTrades;
  const wins = closed.filter((t) => t.pnl > 0).length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  els.winRateText.textContent = `胜率 ${winRate.toFixed(2)}% | 平仓 ${closed.length} 笔`;

  els.bridgeStatus.textContent = state.broker.lastBridgeStatus || brokerStatusText();

  if (day) {
    els.marketPhase.textContent = `最近完成：${day.dateLabel} (${regimeLabel(day.regime)})`;
  }
}

function renderMarketSnapshot() {
  const day = state.market.days[Math.min(state.market.dayIndex, state.market.days.length - 1)] || state.market.days[state.market.dayIndex - 1];
  if (!day) {
    els.marketSnapshot.innerHTML = "<p class='muted'>暂无数据</p>";
    return;
  }

  els.marketRegimeBadge.textContent = `${day.dateLabel} · ${regimeLabel(day.regime)}`;

  const topUp = [...day.quotes].sort((a, b) => b.returnPct - a.returnPct).slice(0, 3);
  const topDown = [...day.quotes].sort((a, b) => a.returnPct - b.returnPct).slice(0, 3);

  const items = [
    { label: "市场情绪", value: pct(day.sentiment), tag: "Sentiment" },
    { label: "成交热度", value: pct(day.turnoverHeat), tag: "Turnover" },
    { label: "领涨", value: topUp.map((q) => `${q.name} ${signedPct(q.returnPct)}`).join(" / "), tag: "Top Up" },
    { label: "领跌", value: topDown.map((q) => `${q.name} ${signedPct(q.returnPct)}`).join(" / "), tag: "Top Down" }
  ];

  els.marketSnapshot.innerHTML = items
    .map(
      (item) => `
        <div class="row">
          <div>
            <div>${item.label}</div>
            <small class="muted">${item.value}</small>
          </div>
          <span class="tag">${item.tag}</span>
        </div>`
    )
    .join("");
}

function renderAgentLog() {
  if (state.logs.messages.length === 0) {
    els.agentLog.innerHTML = `<div class="agent-msg"><p class="agent-body">点击“运行下一交易日”开始模拟。系统会按 intel → signal → risk → execution → review 顺序记录对话与决策。</p></div>`;
    return;
  }

  els.agentLog.innerHTML = state.logs.messages
    .map(
      (msg) => `
        <div class="agent-msg">
          <div class="agent-meta">
            <span class="agent-role ${msg.role}">${msg.role.toUpperCase()}</span>
            <span>${msg.day}</span>
            <span>${msg.time}</span>
          </div>
          <p class="agent-body">${escapeHtml(msg.text)}</p>
        </div>`
    )
    .join("");
}

function renderPositions() {
  const positions = [...state.portfolio.positions].sort((a, b) => b.pnl - a.pnl);
  if (positions.length === 0) {
    els.positionsTable.innerHTML = emptyTable("暂无持仓");
    return;
  }

  const rows = positions
    .map(
      (p) => `
      <tr>
        <td>${p.code}</td>
        <td>${p.name}</td>
        <td class="num">${p.qty}</td>
        <td class="num">${p.avgCost.toFixed(2)}</td>
        <td class="num">${(p.markPrice ?? p.avgCost).toFixed(2)}</td>
        <td class="num ${p.pnl >= 0 ? "text-good" : "text-bad"}">${signedMoney(p.pnl)}</td>
        <td class="num ${p.pnlPct >= 0 ? "text-good" : "text-bad"}">${signedPct(p.pnlPct)}</td>
        <td class="num">T+1至 D${String(p.lastBuyDay + 1).padStart(2, "0")}</td>
      </tr>`
    )
    .join("");

  els.positionsTable.innerHTML = tableHtml(
    ["代码", "名称", "数量", "成本", "现价", "浮盈亏", "收益率", "可卖时间"],
    rows
  );
}

function renderOrders() {
  const orders = state.portfolio.orders.slice(0, 24);
  els.pendingCount.textContent = `待审批 ${countPendingOrders()}`;

  if (orders.length === 0) {
    els.ordersTable.innerHTML = emptyTable("暂无订单建议");
    return;
  }

  const rows = orders
    .map((o) => {
      const statusClass = o.status.includes("reject") ? "text-bad" : o.status.includes("fill") ? "text-good" : "text-warn";
      return `
      <tr>
        <td>${o.dateLabel}</td>
        <td>${o.side}</td>
        <td>${o.code}</td>
        <td class="num">${o.qty}</td>
        <td class="num">${(o.refPrice ?? 0).toFixed(2)}</td>
        <td class="num">${o.fillPrice ? o.fillPrice.toFixed(2) : "-"}</td>
        <td class="${statusClass}">${o.status}</td>
        <td>${escapeHtml(o.note || o.reason || "")}</td>
      </tr>`;
    })
    .join("");

  els.ordersTable.innerHTML = tableHtml(["日", "方向", "代码", "数量", "参考价", "成交价", "状态", "备注"], rows);
}

function renderJournal() {
  const trades = state.portfolio.closedTrades.slice(0, 20);
  if (trades.length === 0) {
    els.journalTable.innerHTML = emptyTable("暂无平仓记录，复盘样本不足");
    return;
  }

  const rows = trades
    .map(
      (t) => `
      <tr>
        <td>D${String(t.dayNumber).padStart(2, "0")}</td>
        <td>${t.code}</td>
        <td>${t.name}</td>
        <td class="num">${t.qty}</td>
        <td class="num">${t.buyCost.toFixed(2)}</td>
        <td class="num">${t.sellPrice.toFixed(2)}</td>
        <td class="num ${t.pnl >= 0 ? "text-good" : "text-bad"}">${signedMoney(t.pnl)}</td>
        <td class="num ${t.pnlPct >= 0 ? "text-good" : "text-bad"}">${signedPct(t.pnlPct)}</td>
        <td>${escapeHtml(t.reason)}</td>
      </tr>`
    )
    .join("");

  els.journalTable.innerHTML = tableHtml(["日", "代码", "名称", "数量", "买入成本", "卖出价", "盈亏", "收益率", "原因"], rows);
}

function renderWeights() {
  const weightEntries = Object.entries(state.learning.weights);
  els.weightsPanel.innerHTML = weightEntries
    .map(([key, val]) => {
      const pctWidth = Math.round(val * 100);
      return `
      <div class="weight-row">
        <span>${labelForWeight(key)}</span>
        <div class="weight-bar"><div class="weight-fill" style="width:${pctWidth}%"></div></div>
        <strong>${val.toFixed(2)}</strong>
      </div>`;
    })
    .join("");

  const notes = [
    `当前阈值: ${state.config.signalThreshold.toFixed(2)}`,
    `最近调整: ${state.learning.lastAdjustment}`,
    `桥接模式: ${state.config.brokerMode}`
  ].concat(state.logs.learningNotes.slice(0, 5));

  els.learningNotes.innerHTML = notes.map((n) => `<div class="note">${escapeHtml(n)}</div>`).join("");
}

function persistAndRender() {
  persistState();
  renderAll();
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to persist state", error);
  }
}

function getHistoryForSymbol(code, dayCount) {
  const history = [];
  for (let i = 0; i < Math.min(dayCount, state.market.days.length); i += 1) {
    const quote = state.market.days[i].quotes.find((q) => q.code === code);
    if (quote) history.push(quote);
  }
  return history;
}

function slipPrice(side, refPrice) {
  const slip = 1 + ((Math.random() - 0.5) * 0.003 + (side === "BUY" ? 0.0012 : -0.0012));
  return round2(refPrice * slip);
}

function brokerStatusText() {
  if (state.config.brokerMode === "sim-auto") return "纯模拟自动执行";
  if (state.config.brokerMode === "sim-approval") return `模拟审批执行（待审批 ${countPendingOrders()}）`;
  if (state.config.brokerMode === "eastmoney-bridge") {
    return state.config.brokerBridgeEndpoint ? `东方财富桥接已配置（待审批 ${countPendingOrders()}）` : "东方财富桥接未配置端点";
  }
  return "未启用";
}

function normalizeWeights(weights) {
  const keys = Object.keys(DEFAULT_WEIGHTS);
  let sum = 0;
  for (const key of keys) {
    if (!Number.isFinite(weights[key])) weights[key] = DEFAULT_WEIGHTS[key];
    sum += weights[key];
  }
  if (sum <= 0) {
    Object.assign(weights, DEFAULT_WEIGHTS);
    return;
  }
  for (const key of keys) {
    weights[key] = round4(weights[key] / sum);
  }
}

function tableHtml(headers, bodyRows) {
  return `
    <table class="table">
      <thead>
        <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}

function emptyTable(message) {
  return `
    <table class="table">
      <tbody><tr><td class="muted">${message}</td></tr></tbody>
    </table>`;
}

function labelForWeight(key) {
  const map = {
    momentum: "趋势",
    pullback: "回撤",
    liquidity: "量能",
    sectorHeat: "板块热度",
    newsBias: "新闻偏置"
  };
  return map[key] || key;
}

function regimeLabel(regime) {
  if (regime === "risk-on") return "偏强轮动";
  if (regime === "risk-off") return "偏弱防守";
  return "震荡分化";
}

function pct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function signedPct(v) {
  const n = Number(v) || 0;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function signedMoney(v) {
  const n = Number(v) || 0;
  return `${n >= 0 ? "+" : "-"}¥${Math.abs(n).toFixed(2)}`;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cryptoRandomId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
