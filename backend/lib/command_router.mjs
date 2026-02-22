import { appendCapped } from '../store.mjs';
import { evaluateDecisionForAshare, normalizeAshareSymbol } from './a_share_rules.mjs';
import { sendDecisionToBridge } from './bridge_client.mjs';
import { applyReceiptToPortfolio, getPortfolioSnapshot, isT1Locked, markSymbolPrice, positionQty } from './portfolio_ledger.mjs';

export function createCommandRouter({ getState, save, buildWorkflow }) {
  return {
    parseCommand,
    extractDiscordCommands,
    extractWhatsappCommands,
    handleCommand,
    formatDiscordDecisionMessage,
    buildDiscordApprovalComponents,
    listDiscordSlashCommands
  };

  function handleMessageLog(source, command) {
    const state = getState();
    appendCapped(state.messages, {
      id: cryptoRandomId(),
      channel: source,
      text: JSON.stringify(command),
      ts: new Date().toISOString()
    }, 500);
  }

  function parseCommand(text) {
    const [rawCmd, ...rest] = String(text || '').trim().split(/\s+/);
    const cmd = (rawCmd || '').toUpperCase();
    if (!cmd) return null;
    if (cmd === 'RUN') return { cmd, symbol: normalizeAshareSymbol(rest[0] || '600519.SH'), mode: (rest[1] || 'hybrid').toLowerCase() };
    if (cmd === 'APPROVE') return { cmd, decisionId: rest[0] };
    if (cmd === 'REJECT') return { cmd, decisionId: rest[0], reason: rest.slice(1).join(' ') || 'manual_reject' };
    if (cmd === 'STATUS') return { cmd };
    if (cmd === 'LIST') return { cmd, target: (rest[0] || 'DECISIONS').toUpperCase() };
    return null;
  }

  function extractDiscordCommands(body) {
    const texts = [];
    if (typeof body?.content === 'string') texts.push(body.content.trim());

    if (body?.type === 'APPLICATION_COMMAND' && body?.data?.name) {
      const name = String(body.data.name).toUpperCase();
      const options = Array.isArray(body.data.options) ? body.data.options : [];
      const map = Object.fromEntries(options.map((o) => [o.name, o.value]));
      if (name === 'RUN') texts.push(`RUN ${map.symbol || '600519.SH'} ${map.mode || 'hybrid'}`);
      if (name === 'APPROVE') texts.push(`APPROVE ${map.decision_id || ''}`.trim());
      if (name === 'REJECT') texts.push(`REJECT ${map.decision_id || ''} ${map.reason || 'discord_reject'}`.trim());
      if (name === 'STATUS') texts.push('STATUS');
      if (name === 'LIST') texts.push(`LIST ${map.target || 'DECISIONS'}`);
    }

    for (const cmd of body?.commands || []) {
      if (typeof cmd === 'string') texts.push(cmd.trim());
    }

    return texts.map(parseCommand).filter(Boolean);
  }

  function extractWhatsappCommands(body) {
    const values = body?.entry?.flatMap((e) => e.changes || []).map((c) => c.value) || [];
    const texts = [];
    for (const value of values) {
      for (const msg of value.messages || []) {
        if (msg.type === 'text' && msg.text?.body) texts.push(msg.text.body.trim());
      }
    }
    return texts.map(parseCommand).filter(Boolean);
  }

  async function handleCommand(command, source = 'api') {
    const state = getState();
    handleMessageLog(source, command);

    if (command.cmd === 'RUN') {
      const workflow = buildWorkflow({ symbol: command.symbol, mode: command.mode || 'hybrid', state });
      const resolvedWorkflow = await workflow;
      markSymbolPrice(state.portfolio, resolvedWorkflow.symbol, resolvedWorkflow.market?.lastPrice);
      appendCapped(state.workflows, resolvedWorkflow, 100);
      if (resolvedWorkflow.orderProposal) appendCapped(state.decisions, resolvedWorkflow.orderProposal, 200);
      save();
      return {
        ok: true,
        type: 'workflow',
        workflowId: resolvedWorkflow.id,
        decisionId: resolvedWorkflow.final.decisionId,
        summary: resolvedWorkflow.final,
        adapter: resolvedWorkflow.adapter,
        discord: resolvedWorkflow.orderProposal
          ? {
              message: formatDiscordDecisionMessage(resolvedWorkflow.orderProposal),
              components: buildDiscordApprovalComponents(resolvedWorkflow.orderProposal)
            }
          : null
      };
    }

    if (command.cmd === 'APPROVE') {
      const decision = state.decisions.find((d) => d.decisionId === command.decisionId);
      if (!decision) return { ok: false, error: 'decision_not_found' };
      if (decision.status !== 'pending_approval') return { ok: false, error: 'decision_not_pending', status: decision.status };

      const ruleCheck = evaluateDecisionForAshare(decision, {
        maxPositionCount: state.config.maxPositionCount,
        maxDailyLossPct: state.config.maxDailyLossPct,
        forceManualApproval: state.config.manualApproval,
        pendingPositions: getPortfolioSnapshot(state.portfolio).positionCount,
        currentPositionQty: positionQty(state.portfolio, decision.symbol),
        t1Locked: isT1Locked(state.portfolio, decision.symbol, new Date().toISOString().slice(0, 10))
      });
      if (!ruleCheck.approvedForBridge) {
        decision.status = 'rule_blocked';
        decision.ruleBlocks = ruleCheck.blocks;
        appendCapped(state.approvals, { decisionId: decision.decisionId, action: 'rule_blocked', source, blocks: ruleCheck.blocks, ts: new Date().toISOString() }, 500);
        save();
        return { ok: false, error: 'rule_blocked', blocks: ruleCheck.blocks, decision };
      }

      decision.status = 'approved';
      decision.approvedAt = new Date().toISOString();
      appendCapped(state.approvals, { decisionId: decision.decisionId, action: 'approved', source, ts: decision.approvedAt }, 500);
      const receipt = await sendDecisionToBridge(decision, state.config);
      appendCapped(state.receipts, receipt, 500);
      decision.status = receipt.accepted ? 'sent_to_bridge' : 'bridge_rejected';
      decision.bridgeReceiptId = receipt.id;
      if (receipt.accepted) {
        const applyResult = applyReceiptToPortfolio({
          ledger: state.portfolio,
          decision,
          receipt,
          tradeDate: new Date().toISOString().slice(0, 10)
        });
        decision.portfolioApplied = applyResult.updated === true;
        if (!applyResult.updated) decision.portfolioApplyError = applyResult.reason;
      }
      save();
      return { ok: true, type: 'approval', decision, receipt };
    }

    if (command.cmd === 'REJECT') {
      const decision = state.decisions.find((d) => d.decisionId === command.decisionId);
      if (!decision) return { ok: false, error: 'decision_not_found' };
      decision.status = 'rejected';
      decision.rejectedAt = new Date().toISOString();
      decision.rejectReason = command.reason;
      appendCapped(state.approvals, { decisionId: decision.decisionId, action: 'rejected', source, reason: command.reason, ts: decision.rejectedAt }, 500);
      save();
      return { ok: true, type: 'rejection', decisionId: decision.decisionId };
    }

    if (command.cmd === 'STATUS') {
      save();
      return {
        ok: true,
        type: 'status',
        pending: state.decisions.filter((d) => d.status === 'pending_approval').length,
        workflows: state.workflows.length,
        receipts: state.receipts.length,
        portfolio: getPortfolioSnapshot(state.portfolio)
      };
    }

    if (command.cmd === 'LIST') {
      if (command.target === 'DECISIONS') {
        return { ok: true, type: 'list', target: 'decisions', items: state.decisions.slice(0, 10) };
      }
      if (command.target === 'WORKFLOWS') {
        return { ok: true, type: 'list', target: 'workflows', items: state.workflows.slice(0, 10) };
      }
      if (command.target === 'PORTFOLIO') {
        return { ok: true, type: 'list', target: 'portfolio', items: getPortfolioSnapshot(state.portfolio) };
      }
      return { ok: false, error: 'unsupported_list_target' };
    }

    return { ok: false, error: 'unsupported_command' };
  }
}

export function formatDiscordDecisionMessage(decision) {
  if (!decision) {
    return { content: '当前没有可审批决策。', embeds: [] };
  }
  const status = String(decision.status || 'pending_approval');
  const color = status === 'pending_approval' ? 0xf4b848 : status.includes('reject') ? 0xef6a6a : 0x21d0a2;
  return {
    content: `交易决策 ${status}`,
    embeds: [
      {
        title: `${decision.side || 'HOLD'} ${decision.symbol || '-'}`,
        color,
        fields: [
          { name: 'Decision ID', value: String(decision.decisionId || '-'), inline: false },
          { name: '数量', value: String(decision.qty || 0), inline: true },
          { name: '参考价', value: String(decision.limitPrice ?? '-'), inline: true },
          { name: '置信度', value: decision.confidence != null ? Number(decision.confidence).toFixed(2) : '-', inline: true },
          { name: '模式', value: String(decision.brokerMode || '-'), inline: true },
          { name: '需审批', value: decision.requiresApproval ? '是' : '否', inline: true },
          { name: '理由', value: String(decision.reason || '-').slice(0, 1000), inline: false }
        ],
        timestamp: decision.createdAt || new Date().toISOString()
      }
    ]
  };
}

export function buildDiscordApprovalComponents(decision) {
  if (!decision?.decisionId) return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Approve', custom_id: `approve:${decision.decisionId}` },
        { type: 2, style: 4, label: 'Reject', custom_id: `reject:${decision.decisionId}` }
      ]
    }
  ];
}

export function listDiscordSlashCommands() {
  return [
    {
      name: 'run',
      description: 'Run one multi-agent workflow for a symbol',
      options: [
        { type: 3, name: 'symbol', description: 'A-share symbol, e.g. 600519.SH', required: false },
        { type: 3, name: 'mode', description: 'trend/pullback/hybrid', required: false }
      ]
    },
    {
      name: 'approve',
      description: 'Approve a pending decision and send to bridge',
      options: [{ type: 3, name: 'decision_id', description: 'Decision UUID', required: true }]
    },
    {
      name: 'reject',
      description: 'Reject a pending decision',
      options: [
        { type: 3, name: 'decision_id', description: 'Decision UUID', required: true },
        { type: 3, name: 'reason', description: 'Reject reason', required: false }
      ]
    },
    { name: 'status', description: 'Show orchestrator status' },
    {
      name: 'list',
      description: 'List recent decisions/workflows',
      options: [{ type: 3, name: 'target', description: 'decisions/workflows/portfolio', required: false }]
    }
  ];
}

function cryptoRandomId() {
  return globalThis.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
