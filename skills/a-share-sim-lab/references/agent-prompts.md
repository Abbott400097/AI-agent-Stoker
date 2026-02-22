# Agent Prompt Skeletons (Local Project)

Use these as prompt templates when wiring real LLM APIs or OpenClaw workflows.

## intel

Goal: summarize market regime and constraints for the day.

Output schema:

```json
{
  "regime": "risk-on | range | risk-off",
  "sentiment": 0.0,
  "turnover_heat": 0.0,
  "hot_sectors": ["新能源"],
  "risks": ["T+1 blocks fast exits"]
}
```

## signal

Goal: rank candidates and expose factor-level reasoning.

Output schema:

```json
{
  "candidates": [
    {
      "code": "300750",
      "side": "BUY",
      "score": 0.71,
      "factors": {
        "momentum": 0.62,
        "pullback": 0.28,
        "liquidity": 0.77,
        "sectorHeat": 0.80,
        "newsBias": 0.58
      },
      "reason": "趋势+量能共振"
    }
  ]
}
```

## risk

Goal: convert candidate list to executable order plan with explicit blocks.

Output schema:

```json
{
  "buy_orders": [],
  "sell_orders": [],
  "blocked_reasons": ["600519 接近涨停，避免追高"]
}
```

## execution

Goal: queue or send orders through simulation or broker bridge.

Minimum receipt schema:

```json
{
  "orderId": "...",
  "accepted": true,
  "message": "bridge accepted"
}
```

## review

Goal: summarize outcome and propose small parameter changes.

Rules:

- Use only realized (closed) trades for weight updates.
- Cap per-update adjustments.
- Record the before/after values and why the change happened.
