# Daily Runbook

## 1. Pre-open (simulation prep)

- Confirm strategy mode and signal threshold.
- Confirm broker mode (`sim-auto`, `sim-approval`, or `eastmoney-bridge`).
- If `eastmoney-bridge`, verify local bridge endpoint and keep manual login in the broker client.
- Clear stale pending orders only after recording why they were not executed.

## 2. Intraday simulation loop (single day)

- Run `intel` to classify regime and board/sector heat.
- Run `signal` to rank symbols and output factors.
- Run `risk` to enforce:
  - T+1 sell restriction
  - max positions
  - cash sufficiency (100-share lots)
  - avoid extreme chase (near limit-up)
- Queue orders in `execution`.
- If approval mode, stop here and request user approval or bridge confirmation.

## 3. Post-close review

- Mark positions to market.
- Compute day PnL, equity, drawdown, win rate.
- Summarize blocked trades and rejected orders.
- Run self-learning only on closed-trade samples; log every parameter adjustment.

## 4. Weekly checkpoint (every 5 trading days)

- Review metrics by regime (`risk-on`, `range`, `risk-off`).
- Compare fill quality vs signal quality (slippage / rejection rate).
- Adjust one or two parameters only; avoid overfitting.
