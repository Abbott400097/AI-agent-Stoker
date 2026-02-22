import http from 'node:http';
import { URL } from 'node:url';
import { buildWorkflow } from './orchestrator.mjs';
import { loadState, saveState } from './store.mjs';
import { createCommandRouter } from './lib/command_router.mjs';
import { interactionMessage, interactionPong, parseComponentCommand, parseDiscordInteraction, readRawBody, verifyDiscordRequestRawEd25519 } from './lib/discord_interactions.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
let state = loadState();
hydrateConfigFromEnv();

const router = createCommandRouter({
  getState: () => state,
  save: () => saveState(state),
  buildWorkflow
});

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

    if (req.method === 'GET' && url.pathname === '/api/workflow/latest') return json(res, 200, state.workflows[0] || null);
    if (req.method === 'GET' && url.pathname === '/api/workflows') return json(res, 200, state.workflows.slice(0, 20));
    if (req.method === 'GET' && url.pathname === '/api/decisions') return json(res, 200, state.decisions.slice(0, 50));
    if (req.method === 'GET' && url.pathname === '/api/receipts') return json(res, 200, state.receipts.slice(0, 50));
    if (req.method === 'GET' && url.pathname === '/api/portfolio') return json(res, 200, state.portfolio || {});
    if (req.method === 'GET' && url.pathname === '/api/discord/commands') return json(res, 200, router.listDiscordSlashCommands());

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
      const body = await readJson(req);
      state.config = { ...state.config, ...(body || {}) };
      saveState(state);
      return json(res, 200, state.config);
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/discord/commands') {
      const body = await readJson(req);
      const commands = router.extractDiscordCommands(body);
      const results = [];
      for (const cmd of commands) results.push(await router.handleCommand(cmd, 'discord'));
      return json(res, 200, { ok: true, commands, results });
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
}
