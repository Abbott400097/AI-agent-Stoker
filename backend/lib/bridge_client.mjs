export async function sendDecisionToBridge(decision, config = {}) {
  const endpoint = config.bridgeEndpoint || 'http://127.0.0.1:8099/eastmoney-sim/order';
  const simulate = config.bridgeSimulate !== false;

  if (simulate) {
    const accepted = Math.random() > 0.08;
    return {
      id: cryptoRandomId(),
      decisionId: decision.decisionId,
      broker: 'eastmoney-sim-bridge',
      endpoint,
      accepted,
      message: accepted ? 'bridge accepted (simulated)' : 'bridge rejected (simulated)',
      ts: new Date().toISOString(),
      simulated: true
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        broker: 'eastmoney-sim',
        orderId: decision.decisionId,
        order: {
          symbol: decision.symbol,
          side: decision.side,
          qty: decision.qty,
          limitPrice: decision.limitPrice,
          reason: decision.reason,
          confidence: decision.confidence
        }
      })
    });

    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }

    return {
      id: cryptoRandomId(),
      decisionId: decision.decisionId,
      broker: 'eastmoney-sim-bridge',
      endpoint,
      accepted: response.ok && body.accepted !== false,
      message: body.message || `bridge http ${response.status}`,
      ts: new Date().toISOString(),
      simulated: false,
      raw: body,
      httpStatus: response.status
    };
  } catch (error) {
    return {
      id: cryptoRandomId(),
      decisionId: decision.decisionId,
      broker: 'eastmoney-sim-bridge',
      endpoint,
      accepted: false,
      message: `bridge error: ${error.message}`,
      ts: new Date().toISOString(),
      simulated: false
    };
  }
}

function cryptoRandomId() {
  return globalThis.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
