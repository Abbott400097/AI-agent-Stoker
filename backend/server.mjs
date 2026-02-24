import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { buildWorkflow } from './orchestrator.mjs';
import { loadState, saveState } from './store.mjs';
import { createCommandRouter } from './lib/command_router.mjs';
import { createAutopilot } from './lib/autopilot.mjs';
import { createScreener } from './lib/screener.mjs';
import { defaultPortfolioLedger } from './lib/portfolio_ledger.mjs';
import { interactionMessage, interactionPong, parseComponentCommand, parseDiscordInteraction, readRawBody, verifyDiscordRequestRawEd25519 } from './lib/discord_interactions.mjs';
import { extractOpenClawCommands, parseOpenClawControlAction, toOpenClawControlResponse, toOpenClawResponse, verifyLocalOrSecretRequest, verifyOpenClawRequest } from './lib/openclaw_adapter.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const OPENCLAW_CONSOLE_HTML = path.resolve('backend/public/openclaw_console.html');
let state = loadState();
hydrateConfigFromEnv();

const router = createCommandRouter({
  getState: () => state,
  save: () => saveState(state),
  buildWorkflow
});
const screener = createScreener({
  getState: () => state,
  save: () => saveState(state)
});
const autopilot = createAutopilot({
  getState: () => state,
  save: () => saveState(state),
  parseCommand: router.parseCommand,
  runParsedCommand: (cmd, source) => router.handleCommand(cmd, source),
  screener
});
bootstrapAutopilotFromConfig();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, {
        ok: true,
        service: 'a-share-ai-lab-orchestrator',
        now: new Date().toISOString(),
        workflows: state.workflows.length,
        pendingApprovals: state.decisions.filter((d) => d.status === 'pending_approval').length,
        config: state.config
      });
    }

    if (req.method === 'GET' && (url.pathname === '/openclaw-console' || url.pathname === '/ui/openclaw')) {
      if (!fs.existsSync(OPENCLAW_CONSOLE_HTML)) return json(res, 404, { ok: false, error: 'openclaw_console_not_found' });
      const html = fs.readFileSync(OPENCLAW_CONSOLE_HTML, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/workflow/latest') return json(res, 200, state.workflows[0] || null);
    if (req.method === 'GET' && url.pathname === '/api/workflows') return json(res, 200, state.workflows.slice(0, 20));
    if (req.method === 'GET' && url.pathname === '/api/decisions') return json(res, 200, state.decisions.slice(0, 50));
    if (req.method === 'GET' && url.pathname === '/api/receipts') return json(res, 200, state.receipts.slice(0, 50));
    if (req.method === 'GET' && url.pathname === '/api/portfolio') return json(res, 200, state.portfolio || {});
    if (req.method === 'GET' && url.pathname === '/api/reviews') return json(res, 200, state.reviews || []);
    if (req.method === 'GET' && url.pathname === '/api/screener/status') return json(res, 200, screener.status());
    if (req.method === 'GET' && url.pathname === '/api/screener/candidates') return json(res, 200, screener.listCandidates());
    if (req.method === 'GET' && url.pathname === '/api/autopilot/status') return json(res, 200, autopilot.status());
    if (req.method === 'GET' && url.pathname === '/api/discord/commands') return json(res, 200, router.listDiscordSlashCommands());
    if (req.method === 'GET' && url.pathname === '/api/openclaw/info') {
      return json(res, 200, {
        ok: true,
        endpoint: '/webhooks/openclaw',
        accepts: ['command', 'commands[]', 'action+params', 'content', 'input.text'],
        examples: [
          { action: 'STATUS' },
          { action: 'RUN', symbol: '600519.SH', mode: 'hybrid' },
          { action: 'APPROVE', decisionId: 'uuid' },
          { action: 'AUTOPILOT_STATUS' },
          { action: 'AUTOPILOT_START' },
          { action: 'SCREENER_RUN' },
          { action: 'SCREENER_ADD', symbol: '300750.SZ' },
          { commands: ['STATUS', 'LIST decisions'] }
        ]
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/workflow/run') {
      const body = await readJson(req);
      const result = await router.handleCommand(router.parseCommand(`RUN ${body?.symbol || '600519.SH'} ${body?.mode || 'hybrid'}`), 'api');
      return json(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/decisions/approve') {
      const body = await readJson(req);
      const result = await router.handleCommand({ cmd: 'APPROVE', decisionId: body?.decisionId }, body?.source || 'api');
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/decisions/reject') {
      const body = await readJson(req);
      const result = await router.handleCommand({ cmd: 'REJECT', decisionId: body?.decisionId, reason: body?.reason || 'manual_reject' }, body?.source || 'api');
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const verify = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret: process.env.OPENCLAW_SHARED_SECRET || ''
      });
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });
      const body = await readJson(req);
      state.config = { ...state.config, ...(body || {}) };
      saveState(state);
      if (body?.autopilot) {
        if (state.config.autopilot?.enabled) autopilot.start(state.config.autopilot);
        else autopilot.stop();
      }
      return json(res, 200, state.config);
    }

    if (req.method === 'POST' && url.pathname === '/api/autopilot/start') {
      const verify = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret: process.env.OPENCLAW_SHARED_SECRET || ''
      });
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });
      const body = await readJson(req);
      state.config.autopilot = { ...(state.config.autopilot || {}), ...(body || {}), enabled: true };
      saveState(state);
      return json(res, 200, autopilot.start(state.config.autopilot));
    }

    if (req.method === 'POST' && url.pathname === '/api/autopilot/stop') {
      const verify = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret: process.env.OPENCLAW_SHARED_SECRET || ''
      });
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });
      state.config.autopilot = { ...(state.config.autopilot || {}), enabled: false };
      saveState(state);
      return json(res, 200, autopilot.stop());
    }

    if (req.method === 'POST' && url.pathname === '/api/autopilot/tick') {
      const verify = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret: process.env.OPENCLAW_SHARED_SECRET || ''
      });
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });
      const body = await readJson(req);
      const result = await autopilot.tick(body?.source || 'api');
      return json(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/autopilot/review') {
      const verify = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret: process.env.OPENCLAW_SHARED_SECRET || ''
      });
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });
      const body = await readJson(req);
      const result = await autopilot.forceReview(body?.reason || 'manual');
      return json(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/screener/run') {
      const verify = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret: process.env.OPENCLAW_SHARED_SECRET || ''
      });
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });
      const body = await readJson(req);
      const result = await screener.run(body || {});
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/screener/candidates/add') {
      const verify = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret: process.env.OPENCLAW_SHARED_SECRET || ''
      });
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });
      const body = await readJson(req);
      const result = screener.addManualSymbol(body?.symbol || body?.ticker);
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/screener/candidates/remove') {
      const verify = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret: process.env.OPENCLAW_SHARED_SECRET || ''
      });
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });
      const body = await readJson(req);
      const result = screener.removeManualSymbol(body?.symbol || body?.ticker);
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const verify = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret: process.env.OPENCLAW_SHARED_SECRET || ''
      });
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });

      state.workflows = [];
      state.decisions = [];
      state.approvals = [];
      state.receipts = [];
      state.messages = [];
      state.screener = { candidates: [], manualSymbols: [], lastRun: null, lastError: null, lastResult: null };
      state.portfolio = defaultPortfolioLedger();
      saveState(state);
      return json(res, 200, { ok: true, reset: true, configPreserved: true });
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/discord/commands') {
      const body = await readJson(req);
      const commands = router.extractDiscordCommands(body);
      const results = [];
      for (const cmd of commands) results.push(await router.handleCommand(cmd, 'discord'));
      return json(res, 200, { ok: true, commands, results });
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/openclaw') {
      const secret = process.env.OPENCLAW_SHARED_SECRET || '';
      const localOrSecret = verifyLocalOrSecretRequest({
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        secret
      });
      if (!localOrSecret.ok) return json(res, 401, { ok: false, error: localOrSecret.error });

      const verify = verifyOpenClawRequest(req.headers, secret);
      if (!verify.ok) return json(res, 401, { ok: false, error: verify.error });

      const body = await readJson(req);
      const control = parseOpenClawControlAction(body);
      if (control) {
        if (control.type === 'autopilot_start') {
          const payload = body?.params || body || {};
          state.config.autopilot = { ...(state.config.autopilot || {}), ...(payload || {}), enabled: true };
          saveState(state);
          return json(res, 200, toOpenClawControlResponse(await autopilot.start(state.config.autopilot)));
        }
        if (control.type === 'autopilot_stop') {
          state.config.autopilot = { ...(state.config.autopilot || {}), enabled: false };
          saveState(state);
          return json(res, 200, toOpenClawControlResponse(await autopilot.stop()));
        }
        if (control.type === 'autopilot_status') return json(res, 200, toOpenClawControlResponse(autopilot.status()));
        if (control.type === 'autopilot_tick') return json(res, 200, toOpenClawControlResponse(await autopilot.tick('openclaw')));
        if (control.type === 'autopilot_review') return json(res, 200, toOpenClawControlResponse(await autopilot.forceReview('openclaw_manual')));
        if (control.type === 'screener_run') {
          const payload = body?.params || body || {};
          return json(res, 200, toOpenClawControlResponse(await screener.run(payload)));
        }
        if (control.type === 'screener_status') return json(res, 200, toOpenClawControlResponse(screener.status()));
        if (control.type === 'screener_add') return json(res, 200, toOpenClawControlResponse(screener.addManualSymbol(body?.symbol || body?.ticker)));
        if (control.type === 'screener_remove') return json(res, 200, toOpenClawControlResponse(screener.removeManualSymbol(body?.symbol || body?.ticker)));
        if (control.type === 'reviews') return json(res, 200, toOpenClawControlResponse({ ok: true, reviews: state.reviews || [] }));
        if (control.type === 'portfolio') return json(res, 200, toOpenClawControlResponse({ ok: true, portfolio: state.portfolio || {} }));
      }

      const extracted = extractOpenClawCommands(body, router.parseCommand);
      if (extracted.parsed.length === 0) {
        return json(res, 400, {
          ok: false,
          error: 'no_openclaw_command_found',
          acceptedShapes: ['command', 'commands[]', 'action+params', 'content', 'input.text']
        });
      }
      const results = [];
      for (const cmd of extracted.parsed) results.push(await router.handleCommand(cmd, 'openclaw'));
      return json(res, 200, toOpenClawResponse({
        commands: extracted.parsed,
        results,
        globalPendingCount: state.decisions.filter((d) => d.status === 'pending_approval').length
      }));
    }

    if (req.method === 'POST' && url.pathname === '/api/discord/message-preview') {
      const body = await readJson(req);
      const decision = body?.decision || state.decisions[0] || null;
      return json(res, 200, {
        ...router.formatDiscordDecisionMessage(decision),
        components: router.buildDiscordApprovalComponents(decision)
      });
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/discord/interactions') {
      const rawBody = await readRawBody(req);
      const verify = verifyDiscordRequestRawEd25519(rawBody, req.headers, process.env.DISCORD_PUBLIC_KEY || '');
      if (!verify.ok) return json(res, 401, { error: 'invalid_discord_signature', detail: verify.error });

      const body = parseJsonBuffer(rawBody);
      const interaction = parseDiscordInteraction(body);

      if (interaction.kind === 'PING') return json(res, 200, interactionPong());

      if (interaction.kind === 'APPLICATION_COMMAND') {
        const commands = router.extractDiscordCommands({
          type: 'APPLICATION_COMMAND',
          data: body.data
        });
        const result = commands[0] ? await router.handleCommand(commands[0], 'discord') : { ok: false, error: 'no_command' };
        return json(res, 200, interactionMessage(toDiscordResponsePayload(result), true));
      }

      if (interaction.kind === 'MESSAGE_COMPONENT') {
        const textCmd = parseComponentCommand(body);
        if (!textCmd) return json(res, 200, interactionMessage({ content: 'Unsupported button.' }, true));
        const parsed = router.parseCommand(textCmd);
        const result = await router.handleCommand(parsed, 'discord');
        return json(res, 200, interactionMessage(toDiscordResponsePayload(result), true));
      }

      return json(res, 200, interactionMessage({ content: 'Unsupported interaction type.' }, true));
    }

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    return json(res, 500, { error: 'internal_error', message: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`orchestrator listening on http://${HOST}:${PORT}`);
});

function toDiscordResponsePayload(result) {
  if (!result) return { content: 'Empty result.' };
  if (result.discord?.message) {
    return {
      ...result.discord.message,
      components: result.discord.components || []
    };
  }
  if (result.type === 'approval' && result.receipt) {
    return {
      content: `审批完成: ${result.decision?.decisionId || ''}`,
      embeds: [
        {
          title: result.receipt.accepted ? '桥接已受理' : '桥接拒绝',
          color: result.receipt.accepted ? 0x21d0a2 : 0xef6a6a,
          fields: [
            { name: 'Decision ID', value: String(result.decision?.decisionId || '-'), inline: false },
            { name: 'Bridge', value: String(result.receipt.broker || '-'), inline: true },
            { name: 'Message', value: String(result.receipt.message || '-'), inline: false }
          ]
        }
      ]
    };
  }
  if (result.type === 'status') {
    return { content: `状态: workflows=${result.workflows}, pending=${result.pending}, receipts=${result.receipts}` };
  }
  if (result.type === 'list') {
    return { content: `列表 ${result.target}: ${result.items.length} 条`, embeds: [] };
  }
  if (result.ok === false) {
    return { content: `失败: ${result.error}${result.blocks ? ` (${result.blocks.join(',')})` : ''}` };
  }
  return { content: JSON.stringify(result).slice(0, 1800) };
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  return parseJsonBuffer(Buffer.concat(chunks));
}

function parseJsonBuffer(buf) {
  const raw = Buffer.from(buf).toString('utf8');
  if (!raw) return null;
  return JSON.parse(raw);
}

function hydrateConfigFromEnv() {
  if (process.env.EASTMONEY_BRIDGE_ENDPOINT) {
    state.config.bridgeEndpoint = process.env.EASTMONEY_BRIDGE_ENDPOINT;
  }
  if (process.env.EASTMONEY_BRIDGE_SIMULATE) {
    state.config.bridgeSimulate = /^true$/i.test(process.env.EASTMONEY_BRIDGE_SIMULATE);
  }
  if (process.env.DISCORD_APPLICATION_ID) state.config.discord.applicationId = process.env.DISCORD_APPLICATION_ID;
  if (process.env.DISCORD_GUILD_ID) state.config.discord.guildId = process.env.DISCORD_GUILD_ID;
  if (process.env.OPENCLAW_SHARED_SECRET) {
    state.config.openclaw = { ...(state.config.openclaw || {}), authEnabled: true };
  }
  if (process.env.AUTOPILOT_POLL_SECS) state.config.autopilot.pollSecs = Math.max(10, Number(process.env.AUTOPILOT_POLL_SECS));
  if (process.env.AUTOPILOT_ENABLED) state.config.autopilot.enabled = /^true$/i.test(process.env.AUTOPILOT_ENABLED);
  if (process.env.AUTOPILOT_AUTO_APPROVE) state.config.autopilot.autoApprove = /^true$/i.test(process.env.AUTOPILOT_AUTO_APPROVE);
  if (process.env.AUTOPILOT_INTRADAY_ENABLED) state.config.autopilot.intradayEnabled = /^true$/i.test(process.env.AUTOPILOT_INTRADAY_ENABLED);
  if (process.env.AUTOPILOT_EOD_REVIEW_ENABLED) state.config.autopilot.eodReviewEnabled = /^true$/i.test(process.env.AUTOPILOT_EOD_REVIEW_ENABLED);
  if (process.env.AUTOPILOT_UNIVERSE) {
    state.config.autopilot.universe = String(process.env.AUTOPILOT_UNIVERSE).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (process.env.BROKER_PROFILE) state.config.brokerProfile = String(process.env.BROKER_PROFILE);
  if (process.env.MARKET_DATA_PROVIDER) state.config.marketData.provider = String(process.env.MARKET_DATA_PROVIDER);
  if (process.env.MARKET_DATA_BASE_URL) state.config.marketData.baseUrl = String(process.env.MARKET_DATA_BASE_URL);
  if (process.env.TRADINGAGENTS_ENABLED) state.config.tradingagents.enabled = /^true$/i.test(process.env.TRADINGAGENTS_ENABLED);
  if (process.env.TRADINGAGENTS_INTRADAY_ENABLED) state.config.tradingagents.intradayEnabled = /^true$/i.test(process.env.TRADINGAGENTS_INTRADAY_ENABLED);
  if (process.env.TRADINGAGENTS_MANUAL_RUN_ENABLED) state.config.tradingagents.manualRunEnabled = /^true$/i.test(process.env.TRADINGAGENTS_MANUAL_RUN_ENABLED);
  if (process.env.SCREENER_ENABLED) state.config.screener.enabled = /^true$/i.test(process.env.SCREENER_ENABLED);
  if (process.env.SCREENER_TOP_N) state.config.screener.topN = Math.max(1, Number(process.env.SCREENER_TOP_N));
  if (process.env.SCREENER_MIN_SCORE) state.config.screener.minScore = Number(process.env.SCREENER_MIN_SCORE);
  if (process.env.SCREENER_AUTO_APPLY_TO_AUTOPILOT) {
    state.config.screener.autoApplyToAutopilot = /^true$/i.test(process.env.SCREENER_AUTO_APPLY_TO_AUTOPILOT);
  }
  if (process.env.SCREENER_UNIVERSE) {
    state.config.screener.universe = String(process.env.SCREENER_UNIVERSE).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

function bootstrapAutopilotFromConfig() {
  if (state.config?.autopilot?.enabled) autopilot.start(state.config.autopilot);
}
