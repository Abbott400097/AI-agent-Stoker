# OpenClaw 接入（本项目主入口）

本项目推荐使用 `OpenClaw` 作为主控入口（多 agent 工作流发起、审批、状态查询）。

交易执行和风控仍由本地 orchestrator 完成：

- orchestrator: `/Users/charles/Documents/New project/backend/server.mjs`
- bridge stub: `/Users/charles/Documents/New project/backend/bridge/eastmoney_sim_bridge.mjs`

## OpenClaw Webhook 入口

- `POST /webhooks/openclaw`

支持的请求格式（任选其一）：

### 1) 文本命令

```json
{ "command": "RUN 600519.SH hybrid" }
```

### 2) 结构化 action（推荐）

```json
{ "action": "RUN", "symbol": "600519.SH", "mode": "hybrid" }
```

可用 action:

- `RUN`
- `APPROVE`
- `REJECT`
- `STATUS`
- `LIST`

示例：

```json
{ "action": "APPROVE", "decisionId": "uuid" }
```

```json
{ "action": "REJECT", "decisionId": "uuid", "reason": "manual_reject" }
```

```json
{ "action": "STATUS" }
```

### 3) 批量命令

```json
{ "commands": ["STATUS", "LIST decisions"] }
```

## 鉴权（可选，建议开启）

在 `.env.local` 配置：

```bash
OPENCLAW_SHARED_SECRET=your_secret
```

请求时加任一请求头：

- `Authorization: Bearer your_secret`
- 或 `x-openclaw-secret: your_secret`

## 本地测试（不依赖 OpenClaw 平台）

```bash
cd "/Users/charles/Documents/New project"
npm run test:openclaw
```

## 常用接口（调试）

- `GET /api/openclaw/info` 查看支持格式
- `GET /api/status`
- `GET /api/portfolio`
- `GET /api/decisions`

## OpenClaw 对接建议

- OpenClaw 负责：工作流编排、Agent 可视化、审批 UI
- orchestrator 负责：命令执行、风控、桥接、账本
- 保持结构化 JSON 通信，不要用自由聊天文本直连下单
