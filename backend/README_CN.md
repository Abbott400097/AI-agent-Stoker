# C方案后端骨架（TradingAgents + AI-Trader 混合）

这个目录是一个本地 orchestrator 骨架，用来承载你要的“多 agent 协作 + 可视化工作流 + OpenClaw 主控 + 东方财富模拟盘桥接”（Discord 为可选入口）。

## 已包含能力（骨架版）

- 多 agent 工作流编排（intel / retrieval / analysis / debate / trader / risk / PM）
- 可追溯工作流结果（JSON）
- 审批队列（pending_approval）
- OpenClaw webhook 接口（结构化命令：`RUN` / `APPROVE` / `REJECT` / `STATUS` / `LIST`）
- Discord 命令 webhook 接口（命令式：`RUN` / `APPROVE` / `REJECT` / `STATUS`）
- Discord 决策消息预览（embed payload）
- Discord interactions 接口（slash command + 按钮 custom_id）
- A股规则引擎模块（手数/符号/审批前规则校验）
- 持仓账本模块（现金/持仓/成交历史/T+1所需状态）
- 东方财富桥接客户端模块（模拟/真实 HTTP 两种路径）
- 东方财富桥接发送位置（当前为模拟回执）
- 可独立运行的东方财富桥接 stub 服务（本地 HTTP，模拟回执/拒单）

## 运行

```bash
npm run start:orchestrator
```

服务默认监听 `http://127.0.0.1:8787`

## 关键接口

- `POST /api/workflow/run` 触发一次多 agent 讨论
- `GET /api/workflow/latest` 查看最近一次工作流
- `GET /api/decisions` 查看待审批/历史决策
- `POST /api/decisions/approve` 审批并发送到桥接器（当前模拟）
- `POST /webhooks/openclaw` 接收 OpenClaw 命令（文本或结构化 payload）
- `GET /api/openclaw/info` 查看 OpenClaw webhook 支持的 payload 格式
- `POST /webhooks/discord/commands` 接收 Discord 命令（文本或适配后的 slash command payload）
- `POST /webhooks/discord/interactions` 接收 Discord 官方 interactions（签名校验）
- `POST /api/discord/message-preview` 生成 Discord embed 预览（用于审批消息）
- `GET /api/discord/commands` 查看 slash commands 定义
- `GET /api/portfolio` 查看本地持仓账本状态

## 与两个 GitHub 项目的混合路线

### 用 TradingAgents 的部分

- 多角色图结构与辩论链路（LangGraph）
- 研究/风控/交易角色拆分
- 流程可视化与执行追踪

### 用 AI-Trader 的部分

- A股规则约束（T+1、100股手数、A股专用配置）
- A股专用 agent / prompt / 日志结构参考
- A股数据组织方式与策略评估思路

### 需要你自己保留的部分（本项目）

- 东方财富模拟盘本地桥接器（登录、下单、回执）
- 审批策略（人审/自动审）
- 你的私有检索源（公告/新闻/自定义数据库）

## 下一步（建议按顺序）

1. 把 `backend/orchestrator.mjs` 的 mock steps 替换为真实 `TradingAgents` 调用
2. 把风控校验移植为 A股规则引擎（借鉴 `AI-Trader`）
3. 把 `simulateBridgeSend()` 换成真实东方财富模拟盘本地桥接 HTTP 调用
4. 给前端加 `/api/workflows` 可视化（节点耗时、证据、投票结果）
5. 增加 OpenClaw 可视化工作流节点映射（把本服务返回映射到 OpenClaw UI）
6. （可选）增加 Discord Bot/Gateway 适配器（把 slash command / 按钮交互转发到本服务）

## 新增文件说明

- `lib/a_share_rules.mjs`: A股规则校验（符号标准化、手数、审批前检查）
- `lib/portfolio_ledger.mjs`: 本地持仓账本与成交落账（为T+1/仓位校验提供状态）
- `lib/bridge_client.mjs`: 东方财富桥接发送客户端（默认模拟）
- `lib/command_router.mjs`: 命令解析、审批执行、Discord消息格式化
- `lib/openclaw_adapter.mjs`: OpenClaw webhook 解析与鉴权（可选 shared secret）
- `lib/discord_interactions.mjs`: Discord interactions 签名校验/解析工具
- `lib/tradingagents_adapter.mjs`: TradingAgents 适配器（默认回退，支持 python-proxy 模式）
- `bridge/eastmoney_sim_bridge.mjs`: 东方财富模拟盘桥接 stub 服务（后续替换 Playwright/RPA）
- `DISCORD_SETUP_CN.md`: Discord 接入步骤
- `OPENCLAW_SETUP_CN.md`: OpenClaw 接入步骤（推荐主入口）

## 本地双服务运行（推荐）

终端1（orchestrator）：

```bash
npm run start:orchestrator
```

终端2（东方财富桥接 stub）：

```bash
npm run start:bridge
```

然后把 orchestrator 配置指向：

- `bridgeEndpoint = http://127.0.0.1:8099/eastmoney-sim/order`
- `bridgeSimulate = false`（让 orchestrator 真正发 HTTP 给本地桥接 stub）

## TradingAgents 适配器模式

- 默认：`TRADINGAGENTS_ADAPTER_MODE=fallback`
- 可选：`TRADINGAGENTS_ADAPTER_MODE=python-proxy`

`python-proxy` 模式下，Node 会调用 `backend/scripts/tradingagents_proxy.py`。如果你的 `TradingAgents` 依赖或 LLM API key 不完整，会返回结构化错误并自动回退，不会中断主流程。
