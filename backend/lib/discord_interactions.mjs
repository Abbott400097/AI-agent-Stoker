import crypto from 'node:crypto';

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function verifyDiscordRequest(rawBody, headers, publicKey) {
  if (!publicKey) return { ok: true, skipped: true };
  const signature = headers['x-signature-ed25519'];
  const timestamp = headers['x-signature-timestamp'];
  if (!signature || !timestamp) return { ok: false, error: 'missing_signature_headers' };

  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'hex'), format: 'der', type: 'spki' });
    const ok = crypto.verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), key, Buffer.from(signature, 'hex'));
    return { ok, skipped: false, error: ok ? null : 'bad_signature' };
  } catch (error) {
    return { ok: false, skipped: false, error: `verify_error:${error.message}` };
  }
}

// Discord public key is a raw 32-byte Ed25519 key, not DER/SPKI.
// Fallback verifier for Node's raw ed25519 support using KeyObject import via JWK.
export function verifyDiscordRequestRawEd25519(rawBody, headers, publicKeyHex) {
  if (!publicKeyHex) return { ok: true, skipped: true };
  const signature = headers['x-signature-ed25519'];
  const timestamp = headers['x-signature-timestamp'];
  if (!signature || !timestamp) return { ok: false, error: 'missing_signature_headers' };
  try {
    const jwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: toBase64Url(Buffer.from(publicKeyHex, 'hex'))
    };
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const ok = crypto.verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), key, Buffer.from(signature, 'hex'));
    return { ok, skipped: false, error: ok ? null : 'bad_signature' };
  } catch (error) {
    return { ok: false, skipped: false, error: `verify_error:${error.message}` };
  }
}

export function parseDiscordInteraction(body) {
  const type = body?.type;
  if (type === 1) return { kind: 'PING', body };
  if (type === 2) return { kind: 'APPLICATION_COMMAND', body };
  if (type === 3) return { kind: 'MESSAGE_COMPONENT', body };
  return { kind: 'UNKNOWN', body };
}

export function interactionPong() {
  return { type: 1 };
}

export function interactionMessage(payload, ephemeral = true) {
  return {
    type: 4,
    data: {
      ...(payload || { content: 'OK' }),
      flags: ephemeral ? 64 : undefined
    }
  };
}

export function interactionDeferred(ephemeral = true) {
  return {
    type: 5,
    data: {
      flags: ephemeral ? 64 : undefined
    }
  };
}

export function parseComponentCommand(interaction) {
  const customId = interaction?.data?.custom_id || '';
  if (customId.startsWith('approve:')) return `APPROVE ${customId.slice('approve:'.length)}`;
  if (customId.startsWith('reject:')) return `REJECT ${customId.slice('reject:'.length)} discord_button_reject`;
  return null;
}

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
