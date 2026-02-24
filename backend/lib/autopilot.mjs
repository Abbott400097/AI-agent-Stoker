const TZ = 'Asia/Shanghai';

export function createAutopilot({ getState, save, runParsedCommand, parseCommand, screener = null }) {
  let timer = null;
  let running = false;
  let tickInFlight = false;
  let cursor = 0;
  let lastSessionKey = '';
  let lastEodReviewDate = '';
  let lastPremarketScreenerDate = '';
  let nextTickAt = null;
  let lastTickAt = null;

  return {
    start,
    stop,
    status,
    tick,
    forceReview
  };

  function ensureStateShape() {
    const state = getState();
    state.autopilot ||= {
      enabled: false,
      mode: 'paper',
      pollSecs: 60,
      autoApprove: false,
      intradayEnabled: true,
      eodReviewEnabled: true,
      universe: [],
      lastRun: null,
      lastResult: null,
      lastError: null,
      stats: { ticks: 0, runs: 0, approvals: 0, reviews: 0 }
    };
    state.reviews ||= [];
    state.screener ||= { candidates: [], manualSymbols: [], lastRun: null, lastError: null, lastResult: null };
    return state;
  }

  function start(options = {}) {
    const state = ensureStateShape();
    state.autopilot = {
      ...state.autopilot,
      enabled: true,
      pollSecs: Math.max(10, Number(options.pollSecs || state.autopilot.pollSecs || 60)),
      autoApprove: options.autoApprove ?? state.autopilot.autoApprove ?? false,
      intradayEnabled: options.intradayEnabled ?? state.autopilot.intradayEnabled ?? true,
      eodReviewEnabled: options.eodReviewEnabled ?? state.autopilot.eodReviewEnabled ?? true,
      universe: Array.isArray(options.universe) && options.universe.length ? options.universe : (state.autopilot.universe || []),
      lastError: null
    };
    save();
    running = true;
    scheduleLoop();
    return status();
  }

  function stop() {
    const state = ensureStateShape();
    state.autopilot.enabled = false;
    save();
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    nextTickAt = null;
    return status();
  }

  function status() {
    const state = ensureStateShape();
    const clock = getChinaMarketClock();
    return {
      ok: true,
      running,
      tickInFlight,
      nextTickAt,
      lastTickAt,
      marketClock: clock,
      autopilot: state.autopilot,
      screener: {
        enabled: Boolean(state.config?.screener?.enabled),
        candidateCount: Array.isArray(state.screener?.candidates) ? state.screener.candidates.length : 0,
        manualCount: Array.isArray(state.screener?.manualSymbols) ? state.screener.manualSymbols.length : 0,
        lastRun: state.screener?.lastRun || null,
        lastError: state.screener?.lastError || null
      }
    };
  }

  async function forceReview(reason = 'manual') {
    const state = ensureStateShape();
    const review = buildEodReview(state, reason);
    state.autopilot.lastResult = { type: 'review', reviewId: review.id };
    state.autopilot.stats.reviews = Number(state.autopilot.stats.reviews || 0) + 1;
    lastEodReviewDate = review.tradeDate;
    save();
    return { ok: true, type: 'review', review };
  }

  function scheduleLoop() {
    if (timer) clearTimeout(timer);
    const state = ensureStateShape();
    const intervalMs = Math.max(10, Number(state.autopilot.pollSecs || 60)) * 1000;
    nextTickAt = new Date(Date.now() + intervalMs).toISOString();
    timer = setTimeout(async () => {
      try {
        await tick('scheduler');
      } finally {
        if (running && ensureStateShape().autopilot.enabled) scheduleLoop();
      }
    }, intervalMs);
  }

  async function tick(source = 'manual') {
    if (tickInFlight) return { ok: false, error: 'tick_in_flight' };
    tickInFlight = true;
    lastTickAt = new Date().toISOString();
    try {
      const state = ensureStateShape();
      state.autopilot.stats.ticks = Number(state.autopilot.stats.ticks || 0) + 1;
      state.autopilot.lastRun = lastTickAt;

      const clock = getChinaMarketClock();
      const sessionKey = `${clock.date}#${clock.session}`;
      if (sessionKey !== lastSessionKey) lastSessionKey = sessionKey;

      if (clock.isTrading && state.autopilot.intradayEnabled) {
        const runResult = await intradayRun(state, source);
        state.autopilot.lastResult = { type: 'intraday', ...runResult.meta };
        state.autopilot.lastError = null;
        save();
        return { ok: true, type: 'intraday', marketClock: clock, ...runResult };
      }

      if (clock.session === 'preopen' && screener && state.config?.screener?.enabled) {
        if (lastPremarketScreenerDate !== clock.date) {
          const screenerResult = await screener.run({ mode: 'trend' });
          if (screenerResult?.ok) {
            lastPremarketScreenerDate = clock.date;
            state.autopilot.lastResult = {
              type: 'screener',
              accepted: screenerResult.result?.accepted ?? 0,
              scanned: screenerResult.result?.scanned ?? 0
            };
            state.autopilot.lastError = null;
            save();
            return { ok: true, type: 'screener', marketClock: clock, screener: screenerResult };
          }
          state.autopilot.lastError = screenerResult?.error || 'screener_failed';
          save();
          return { ok: false, type: 'screener', marketClock: clock, error: state.autopilot.lastError };
        }
      }

      if (clock.isPostClose && state.autopilot.eodReviewEnabled && lastEodReviewDate !== clock.date) {
        const review = buildEodReview(state, 'scheduled_eod');
        state.autopilot.lastResult = { type: 'review', reviewId: review.id };
        state.autopilot.stats.reviews = Number(state.autopilot.stats.reviews || 0) + 1;
        lastEodReviewDate = clock.date;
        state.autopilot.lastError = null;
        save();
        return { ok: true, type: 'review', marketClock: clock, review };
      }

      state.autopilot.lastResult = { type: 'idle', session: clock.session };
      save();
      return { ok: true, type: 'idle', marketClock: clock, reason: clock.session };
    } catch (error) {
      const state = ensureStateShape();
      state.autopilot.lastError = String(error?.message || error);
      save();
      return { ok: false, error: state.autopilot.lastError };
    } finally {
      tickInFlight = false;
    }
  }

  async function intradayRun(state, source) {
    const recommendedUniverse =
      screener &&
      state.config?.screener?.enabled &&
      typeof screener.getEffectiveUniverse === 'function'
        ? screener.getEffectiveUniverse()
        : [];
    const universe = (
      state.autopilot.universe && state.autopilot.universe.length
        ? state.autopilot.universe
        : recommendedUniverse.length
          ? recommendedUniverse
          : state.config?.defaultUniverse
    ) || ['600519.SH'];
    const symbol = universe[cursor % universe.length];
    cursor += 1;

    const mode = pickModeByClock(getChinaMarketClock());
    const parsedRun = parseCommand(`RUN ${symbol} ${mode}`);
    const workflowResult = await runParsedCommand(parsedRun, `autopilot:${source}`);
    state.autopilot.stats.runs = Number(state.autopilot.stats.runs || 0) + 1;

    let approvalResult = null;
    if (state.autopilot.autoApprove && workflowResult?.decisionId) {
      approvalResult = await runParsedCommand({ cmd: 'APPROVE', decisionId: workflowResult.decisionId }, `autopilot:${source}`);
      if (approvalResult?.ok) state.autopilot.stats.approvals = Number(state.autopilot.stats.approvals || 0) + 1;
    }

    return {
      workflow: workflowResult,
      approval: approvalResult,
      meta: {
        symbol,
        mode,
        decisionId: workflowResult?.decisionId || null,
        autoApproved: Boolean(approvalResult?.ok)
      }
    };
  }
}

export function getChinaMarketClock(now = new Date()) {
  const p = chinaParts(now);
  const minutes = p.hour * 60 + p.minute;
  const weekday = p.weekdayIndex; // 0=Sun
  const isWeekday = weekday >= 1 && weekday <= 5;

  let session = 'closed';
  let isTrading = false;
  let isPostClose = false;

  if (isWeekday) {
    if (minutes >= 9 * 60 + 15 && minutes < 9 * 60 + 30) session = 'preopen';
    else if (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30) {
      session = 'morning';
      isTrading = true;
    } else if (minutes >= 11 * 60 + 30 && minutes < 13 * 60) session = 'midday_break';
    else if (minutes >= 13 * 60 && minutes < 15 * 60) {
      session = 'afternoon';
      isTrading = true;
    } else if (minutes >= 15 * 60 && minutes < 16 * 60 + 30) {
      session = 'postclose';
      isPostClose = true;
    }
  }

  return {
    tz: TZ,
    date: p.date,
    time: `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`,
    weekdayIndex: weekday,
    isWeekday,
    session,
    isTrading,
    isPostClose
  };
}

function pickModeByClock(clock) {
  if (clock.session === 'morning') return 'trend';
  if (clock.session === 'afternoon') return 'hybrid';
  return 'hybrid';
}

function buildEodReview(state, reason) {
  const now = new Date();
  const clock = getChinaMarketClock(now);
  const date = clock.date;
  const approvalsToday = (state.approvals || []).filter((a) => String(a.ts || '').startsWith(date));
  const receiptsToday = (state.receipts || []).filter((r) => String(r.ts || '').startsWith(date));
  const workflowsToday = (state.workflows || []).filter((w) => String(w.createdAt || '').startsWith(date));
  const tradesToday = (state.portfolio?.trades || []).filter((t) => String(t.tradeDate || '').startsWith(date));

  const buyCount = tradesToday.filter((t) => t.side === 'BUY').length;
  const sellCount = tradesToday.filter((t) => t.side === 'SELL').length;
  const realizedPnl = round2(tradesToday.reduce((sum, t) => sum + Number(t.realizedPnl || 0), 0));
  const fallbackCount = workflowsToday.filter((w) => w.adapter?.tradingagents?.source === 'fallback').length;

  const review = {
    id: crypto.randomUUID(),
    ts: now.toISOString(),
    tradeDate: date,
    reason,
    summary: {
      workflows: workflowsToday.length,
      approvals: approvalsToday.length,
      receipts: receiptsToday.length,
      trades: tradesToday.length,
      buyCount,
      sellCount,
      realizedPnl,
      fallbackCount
    },
    learning: suggestParameterTuning({
      realizedPnl,
      fallbackRate: workflowsToday.length ? fallbackCount / workflowsToday.length : 0,
      trades: tradesToday.length
    })
  };

  state.reviews ||= [];
  state.reviews.unshift(review);
  if (state.reviews.length > 120) state.reviews.length = 120;

  // Lightweight "self-upgrade": tune poll interval conservatively based on runtime quality.
  state.autopilot ||= {};
  if (review.learning?.apply?.pollSecs != null) {
    state.autopilot.pollSecs = review.learning.apply.pollSecs;
  }

  return review;
}

function suggestParameterTuning({ realizedPnl, fallbackRate, trades }) {
  let suggestion = '保持参数不变';
  const apply = {};
  if (fallbackRate > 0.8) {
    suggestion = 'TradingAgents超时比例高，适度降低巡航频率以减少卡顿';
    apply.pollSecs = 90;
  } else if (fallbackRate < 0.3 && trades === 0) {
    suggestion = '模型调用较稳定但触发偏少，可略提高巡航频率';
    apply.pollSecs = 45;
  } else if (realizedPnl < 0 && trades > 3) {
    suggestion = '当日表现偏弱，次日降低节奏';
    apply.pollSecs = 90;
  }
  return { suggestion, apply };
}

function chinaParts(now) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short'
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekdayIndex: mapWeekday(parts.weekday)
  };
}

function mapWeekday(w) {
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[w] ?? -1);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}
