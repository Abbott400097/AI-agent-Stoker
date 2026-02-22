---
name: a-share-sim-lab
description: Build, operate, and iterate a multi-agent A-share simulation trading lab with strict risk controls, daily review, and broker bridge adapters (especially Eastmoney simulated trading via local bridge/manual approval). Use when Codex is asked to design workflows, prompts, logs, agent roles, review loops, or integration scaffolding for A-share AI trading experiments.
---

# A-Share Sim Lab

Use this skill to extend the local A-share AI trading project safely and consistently.

## Keep the objective realistic

- Optimize process quality, execution discipline, and review speed.
- Do not promise profitability.
- Default to simulated trading and manual approval when broker automation is involved.
- Treat Eastmoney integration as a bridge-adapter problem, not an in-app credential scripting problem.

## Use this workflow

1. Read the current project state and identify what changed since the last run.
2. Confirm the strategy scope: trend / pullback / hybrid, universe, and risk limits.
3. Preserve or improve these modules before adding complexity:
   - signal generation
   - risk review (T+1, position cap, stop logic)
   - execution queue / approvals
   - journal / review logging
   - self-learning parameter updates
4. Keep agent outputs structured (JSON-compatible fields) even if UI renders prose.
5. Add bridge receipts to the review loop whenever broker integration changes.
6. Run a local smoke test after edits (syntax check, sample run, UI sanity).

## Agent role contract

- `intel`: Summarize market regime, sector heat, notable constraints.
- `signal`: Rank candidates with scores and factor breakdowns.
- `risk`: Filter/resize orders, explain blocks (T+1, limits, cash, concentration).
- `execution`: Queue, approve, send, and log receipts.
- `review`: Summarize results and trigger parameter adjustments.

## Eastmoney simulated trading integration guardrails

- Use a local bridge endpoint (browser extension, RPA, or WebDriver) managed by the user.
- Do not store plaintext credentials in project files.
- Default to approval-first mode.
- Require bridge receipts (`accepted`, `message`, `orderId`) for each order.
- Log rejected orders for review-agent analysis.

## Read references only when needed

- Daily operating loop: `references/daily-runbook.md`
- Agent prompt skeletons and output schema: `references/agent-prompts.md`
