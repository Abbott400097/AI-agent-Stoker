export function verifyOpenClawRequest(headers, secret) {
  if (!secret) return { ok: true, skipped: true };
  const auth = headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  const headerSecret = headers['x-openclaw-secret'] || '';
  const ok = bearer === secret || headerSecret === secret;
  return { ok, skipped: false, error: ok ? null : 'invalid_openclaw_secret' };
}

export function verifyLocalOrSecretRequest({ headers, remoteAddress, secret }) {
  if (isLoopbackAddress(remoteAddress)) return { ok: true, mode: 'loopback' };
  if (!secret) return { ok: false, error: 'missing_shared_secret_for_non_loopback' };
  const auth = headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  const headerSecret = headers['x-openclaw-secret'] || headers['x-admin-secret'] || '';
  const ok = bearer === secret || headerSecret === secret;
  return { ok, mode: 'secret', error: ok ? null : 'invalid_shared_secret' };
}

export function extractOpenClawCommands(body, parseCommand) {
  const texts = [];
  if (typeof body?.command === 'string') texts.push(body.command.trim());
  if (typeof body?.content === 'string') texts.push(body.content.trim());
  if (typeof body?.text === 'string') texts.push(body.text.trim());
  if (typeof body?.input?.text === 'string') texts.push(body.input.text.trim());

  if (Array.isArray(body?.commands)) {
    for (const cmd of body.commands) {
      if (typeof cmd === 'string') texts.push(cmd.trim());
      else if (cmd && typeof cmd.command === 'string') texts.push(String(cmd.command).trim());
    }
  }

  const action = String(body?.action || body?.cmd || '').toUpperCase();
  if (action) {
    if (action === 'RUN') {
      texts.push(`RUN ${body?.symbol || body?.ticker || '600519.SH'} ${body?.mode || 'hybrid'}`);
    } else if (action === 'APPROVE') {
      texts.push(`APPROVE ${body?.decisionId || body?.decision_id || ''}`.trim());
    } else if (action === 'REJECT') {
      texts.push(`REJECT ${body?.decisionId || body?.decision_id || ''} ${body?.reason || 'openclaw_reject'}`.trim());
    } else if (action === 'STATUS') {
      texts.push('STATUS');
    } else if (action === 'LIST') {
      texts.push(`LIST ${body?.target || 'DECISIONS'}`);
    }
  }

  const parsed = texts.map(parseCommand).filter(Boolean);
  return { texts, parsed };
}

export function toOpenClawResponse({ commands, results, globalPendingCount }) {
  const pending = [];
  for (const result of results || []) {
    if (result?.type === 'workflow' && result?.decisionId) {
      pending.push({
        decisionId: result.decisionId,
        summary: result.summary,
        action: result.summary?.action,
        confidence: result.summary?.confidence
      });
    }
  }

  return {
    ok: true,
    channel: 'openclaw',
    commands,
    results,
    approvals: {
      pendingCount: Number.isFinite(Number(globalPendingCount)) ? Number(globalPendingCount) : pending.length,
      currentRequestPendingCount: pending.length,
      pending
    }
  };
}

function isLoopbackAddress(remoteAddress) {
  const v = String(remoteAddress || '');
  return v === '127.0.0.1' || v === '::1' || v === '::ffff:127.0.0.1';
}
