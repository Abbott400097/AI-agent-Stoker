export function buildOpenClawVisualFromResult(result) {
  if (!result || typeof result !== 'object') return null;

  if (result.type === 'workflow') return workflowVisual(result);
  if (result.marketClock && result.autopilot) return autopilotStatusVisual(result);
  if (result.type === 'status') return statusVisual(result);
  if (result.type === 'approval') return approvalVisual(result);
  if (result.type === 'rejection') return simpleEventVisual('rejection', `已拒绝 ${result.decisionId || ''}`.trim(), result);
  if (result.type === 'review') return reviewVisual(result.review || result);
  if (Array.isArray(result.reviews)) return reviewsVisual(result.reviews);
  if (result.portfolio || result.type === 'portfolio') return portfolioVisual(result.portfolio || result);
  if (result.type === 'intraday' || result.type === 'idle' || result.type === 'screener') return autopilotVisual(result);
  if (result.type === 'screener_run') return screenerRunVisual(result);
  if (result.screener && result.config) return screenerStatusVisual(result);

  return {
    kind: 'generic',
    title: result.type || 'result',
    blocks: [{ type: 'json', value: trimJson(result, 2500) }]
  };
}

export function attachOpenClawVisualsToResults(results) {
  return (results || []).map((r) => {
    const visual = buildOpenClawVisualFromResult(r);
    return visual ? { ...r, openclawView: visual } : r;
  });
}

export function buildOpenClawVisualSummary(results) {
  const cards = [];
  for (const r of results || []) {
    const visual = buildOpenClawVisualFromResult(r);
    if (!visual) continue;
    cards.push({
      kind: visual.kind,
      title: visual.title,
      subtitle: visual.subtitle || null,
      status: visual.status || null
    });
  }
  return { cards, count: cards.length };
}

function workflowVisual(result) {
  const w = result.workflow || result;
  const summary = w.summary || w.final || {};
  const market = w.market || {};
  const indicators = w.indicators || {};
  const steps = Array.isArray(w.steps) ? w.steps : [];
  const latestStepSummaries = steps.slice(-8).map((s) => ({
    id: s.id,
    agent: s.agent,
    summary: s.payload?.summary || null,
    ts: s.ts || null
  }));

  return {
    kind: 'workflow',
    title: `${summary.action || 'HOLD'} ${w.symbol || result.symbol || ''}`.trim(),
    subtitle: `mode=${w.mode || result.mode || '-'} | confidence=${fmtNum(summary.confidence, 2)}`,
    status: summary.approved ? 'approved' : (summary.action === 'HOLD' ? 'hold' : 'blocked'),
    badges: [
      badge('data', market.source || 'unknown'),
      badge('ta', w.adapter?.tradingagents?.source || result.adapter?.tradingagents?.source || 'n/a'),
      badge('bias', indicators.bias || 'n/a')
    ],
    blocks: [
      {
        type: 'kv',
        title: 'Market',
        items: {
          symbol: w.symbol || null,
          price: market.lastPrice ?? null,
          dayChangePct: market.dayChangePct ?? null,
          regime: market.regime || null,
          asOf: market.asOf || null
        }
      },
      {
        type: 'kv',
        title: 'Indicators',
        items: {
          source: indicators.source || null,
          composite: indicators.scores?.composite ?? null,
          trend: indicators.scores?.trend ?? null,
          momentum: indicators.scores?.momentum ?? null,
          liquidity: indicators.scores?.liquidity ?? null,
          rsi14: indicators.metrics?.rsi14 ?? null,
          ma5: indicators.metrics?.ma5 ?? null,
          ma10: indicators.metrics?.ma10 ?? null,
          ma20: indicators.metrics?.ma20 ?? null
        }
      },
      {
        type: 'kv',
        title: 'Decision',
        items: {
          action: summary.action || null,
          approved: summary.approved ?? null,
          confidence: summary.confidence ?? null,
          reason: summary.reason || null,
          decisionId: summary.decisionId || result.decisionId || null
        }
      },
      {
        type: 'timeline',
        title: 'Agent Steps',
        items: latestStepSummaries
      }
    ]
  };
}

function statusVisual(result) {
  return {
    kind: 'status',
    title: '系统状态',
    subtitle: `workflows=${result.workflows ?? 0}, pending=${result.pending ?? 0}, receipts=${result.receipts ?? 0}`,
    status: 'ok',
    blocks: [
      {
        type: 'kv',
        title: 'Counts',
        items: {
          workflows: result.workflows ?? 0,
          pending: result.pending ?? 0,
          receipts: result.receipts ?? 0
        }
      },
      {
        type: 'kv',
        title: 'Portfolio',
        items: {
          equity: result.portfolio?.equity ?? null,
          marketValue: result.portfolio?.marketValue ?? null,
          cash: result.portfolio?.cash ?? null,
          positionCount: result.portfolio?.positionCount ?? null
        }
      }
    ]
  };
}

function approvalVisual(result) {
  return {
    kind: 'approval',
    title: `审批 ${result.receipt?.accepted ? '成功' : '失败'}`,
    subtitle: `${result.decision?.side || '-'} ${result.decision?.symbol || '-'}`,
    status: result.receipt?.accepted ? 'accepted' : 'rejected',
    blocks: [
      {
        type: 'kv',
        title: 'Decision',
        items: {
          decisionId: result.decision?.decisionId || null,
          status: result.decision?.status || null,
          portfolioApplied: result.decision?.portfolioApplied ?? null,
          portfolioApplyError: result.decision?.portfolioApplyError || null
        }
      },
      {
        type: 'kv',
        title: 'Bridge Receipt',
        items: {
          broker: result.receipt?.broker || null,
          accepted: result.receipt?.accepted ?? null,
          message: result.receipt?.message || null,
          fillPrice: result.receipt?.raw?.fillPrice ?? null
        }
      }
    ]
  };
}

function reviewVisual(review) {
  return {
    kind: 'review',
    title: `复盘 ${review?.tradeDate || ''}`.trim(),
    subtitle: review?.reason || null,
    status: 'ok',
    blocks: [
      { type: 'kv', title: 'Summary', items: review?.summary || {} },
      { type: 'kv', title: 'Learning', items: review?.learning || {} }
    ]
  };
}

function reviewsVisual(reviews) {
  return {
    kind: 'reviews',
    title: '复盘列表',
    subtitle: `${reviews.length} 条`,
    status: 'ok',
    blocks: [
      {
        type: 'table',
        title: 'Recent Reviews',
        rows: reviews.slice(0, 10).map((r) => ({
          tradeDate: r.tradeDate,
          reason: r.reason,
          workflows: r.summary?.workflows ?? 0,
          trades: r.summary?.trades ?? 0,
          fallbackCount: r.summary?.fallbackCount ?? 0
        }))
      }
    ]
  };
}

function portfolioVisual(portfolio) {
  const positions = Array.isArray(portfolio?.positions)
    ? portfolio.positions
    : Object.entries(portfolio?.positions || {}).map(([symbol, p]) => ({
        symbol,
        ...(p || {})
      }));
  return {
    kind: 'portfolio',
    title: '持仓与资金',
    subtitle: `equity=${fmtNum(portfolio?.equity)} cash=${fmtNum(portfolio?.cash)}`,
    status: 'ok',
    blocks: [
      {
        type: 'kv',
        title: 'Account',
        items: {
          equity: portfolio?.equity ?? null,
          cash: portfolio?.cash ?? null,
          marketValue: portfolio?.marketValue ?? null,
          positionCount: portfolio?.positionCount ?? null
        }
      },
      {
        type: 'table',
        title: 'Positions',
        rows: positions.slice(0, 20).map((p) => ({
          symbol: p.symbol,
          qty: p.qty,
          avgCost: p.avgCost,
          markPrice: p.markPrice,
          unrealizedPnl: p.unrealizedPnl
        }))
      }
    ]
  };
}

function autopilotVisual(result) {
  const workflow = result.workflow;
  const wfSummary = workflow?.summary || {};
  return {
    kind: 'autopilot',
    title: `Autopilot ${result.type || 'status'}`,
    subtitle: result.marketClock ? `${result.marketClock.date} ${result.marketClock.time} (${result.marketClock.session})` : null,
    status: result.ok === false ? 'error' : 'ok',
    blocks: [
      {
        type: 'kv',
        title: 'Meta',
        items: {
          session: result.marketClock?.session || null,
          symbol: result.meta?.symbol || null,
          mode: result.meta?.mode || null,
          autoApproved: result.meta?.autoApproved ?? null
        }
      },
      workflow ? {
        type: 'kv',
        title: 'Workflow',
        items: {
          action: wfSummary.action || null,
          confidence: wfSummary.confidence ?? null,
          reason: wfSummary.reason || null,
          taSource: workflow.adapter?.tradingagents?.source || null,
          taReason: workflow.adapter?.tradingagents?.reason || null
        }
      } : null,
      result.screener ? {
        type: 'kv',
        title: 'Screener',
        items: {
          accepted: result.screener?.result?.accepted ?? null,
          scanned: result.screener?.result?.scanned ?? null
        }
      } : null
    ].filter(Boolean)
  };
}

function autopilotStatusVisual(result) {
  return {
    kind: 'autopilot-status',
    title: 'Autopilot 状态',
    subtitle: result.marketClock ? `${result.marketClock.date} ${result.marketClock.time} (${result.marketClock.session})` : null,
    status: result.running ? 'running' : 'stopped',
    blocks: [
      {
        type: 'kv',
        title: 'Runtime',
        items: {
          running: result.running ?? null,
          tickInFlight: result.tickInFlight ?? null,
          nextTickAt: result.nextTickAt || null,
          lastTickAt: result.lastTickAt || null
        }
      },
      {
        type: 'kv',
        title: 'Config',
        items: {
          enabled: result.autopilot?.enabled ?? null,
          pollSecs: result.autopilot?.pollSecs ?? null,
          autoApprove: result.autopilot?.autoApprove ?? null,
          intradayEnabled: result.autopilot?.intradayEnabled ?? null,
          eodReviewEnabled: result.autopilot?.eodReviewEnabled ?? null
        }
      },
      {
        type: 'kv',
        title: 'Stats',
        items: result.autopilot?.stats || {}
      },
      result.screener ? {
        type: 'kv',
        title: 'Screener',
        items: result.screener
      } : null
    ].filter(Boolean)
  };
}

function screenerRunVisual(result) {
  const r = result.result || {};
  return {
    kind: 'screener',
    title: '盘前选股结果',
    subtitle: `accepted=${r.accepted ?? 0}/${r.scanned ?? 0}`,
    status: result.ok ? 'ok' : 'error',
    blocks: [
      {
        type: 'kv',
        title: 'Run',
        items: {
          mode: r.mode || null,
          topN: r.topN ?? null,
          minScore: r.minScore ?? null,
          scanned: r.scanned ?? null,
          accepted: r.accepted ?? null
        }
      },
      {
        type: 'table',
        title: 'Candidates',
        rows: (r.candidates || []).slice(0, 20).map((c) => ({
          symbol: c.symbol,
          score: c.score,
          price: c.market?.lastPrice,
          chgPct: c.market?.dayChangePct,
          bias: c.indicators?.bias,
          data: c.market?.source
        }))
      },
      {
        type: 'table',
        title: 'Effective Universe',
        rows: (result.effectiveUniverse || []).map((s) => ({ symbol: s }))
      }
    ]
  };
}

function screenerStatusVisual(result) {
  const screener = result.screener || {};
  const candidates = screener.candidates || [];
  return {
    kind: 'screener',
    title: '盘前选股状态',
    subtitle: `candidates=${candidates.length}, manual=${(screener.manualSymbols || []).length}`,
    status: 'ok',
    blocks: [
      {
        type: 'kv',
        title: 'Config',
        items: {
          enabled: result.config?.enabled ?? null,
          topN: result.config?.topN ?? null,
          minScore: result.config?.minScore ?? null,
          autoApplyToAutopilot: result.config?.autoApplyToAutopilot ?? null,
          lastRun: screener.lastRun || null,
          lastError: screener.lastError || null
        }
      },
      {
        type: 'table',
        title: 'Manual Symbols',
        rows: (screener.manualSymbols || []).map((s) => ({ symbol: s }))
      },
      {
        type: 'table',
        title: 'Candidates',
        rows: candidates.slice(0, 20).map((c) => ({
          symbol: c.symbol,
          score: c.score,
          price: c.market?.lastPrice,
          data: c.market?.source
        }))
      }
    ]
  };
}

function simpleEventVisual(kind, title, payload) {
  return { kind, title, status: 'ok', blocks: [{ type: 'kv', title: 'Detail', items: payload || {} }] };
}

function badge(key, value) {
  return { key, value };
}

function fmtNum(v, digits = 2) {
  if (v == null || Number.isNaN(Number(v))) return '-';
  return Number(v).toFixed(digits);
}

function trimJson(v, maxChars) {
  const s = JSON.stringify(v);
  return s.length <= maxChars ? s : `${s.slice(0, maxChars)}...`;
}
