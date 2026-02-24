# 一键启动（GLM）

以后不需要每次手动 `export` 一堆变量。

## 第一次配置（只做一次）

```bash
cd "/Users/charles/Documents/New project"
cp .env.local.example .env.local
```

然后编辑 `.env.local`，只需要改：

- `OPENAI_API_KEY=你的GLM完整key`
- 如果模型名不对，再改 `TRADINGAGENTS_DEEP_MODEL` 和 `TRADINGAGENTS_QUICK_MODEL`

## 每次启动（3个终端）

终端A（orchestrator）

```bash
cd "/Users/charles/Documents/New project"
npm run glm
```

终端B（bridge 8100）

```bash
cd "/Users/charles/Documents/New project"
npm run bridge:8100
```

终端C（测试跑一轮）

```bash
cd "/Users/charles/Documents/New project"
npm run test:run
```

如果返回里有 `decisionId`，审批：

```bash
cd "/Users/charles/Documents/New project"
sh scripts/approve.sh 这里替换decisionId
```

查看持仓：

```bash
curl http://127.0.0.1:8787/api/portfolio
```

## OpenClaw 跑通（推荐主入口）

本项目现在建议用 `OpenClaw` 做主入口，Discord 作为可选项。

### 本地联调（OpenClaw 模拟）

终端A（orchestrator, GLM）

```bash
cd "/Users/charles/Documents/New project"
npm run glm
```

终端B（bridge）

```bash
cd "/Users/charles/Documents/New project"
npm run bridge:8100
```

终端C（模拟 OpenClaw 发命令）

```bash
cd "/Users/charles/Documents/New project"
npm run test:openclaw
```

如果返回里有 `decisionId`，审批：

```bash
cd "/Users/charles/Documents/New project"
sh scripts/approve.sh 这里替换decisionId
```

查看 OpenClaw webhook 支持格式：

```bash
curl http://127.0.0.1:8787/api/openclaw/info
```

详细说明见：

- `/Users/charles/Documents/New project/backend/OPENCLAW_SETUP_CN.md`

## 一键运行（盘中巡航 + 收盘复盘骨架）

你说的目标是对的：不是手工一条条 `RUN`，而是盘中动态巡航、收盘复盘、自我微调。

本项目现在已经有一个轻量 `autopilot` 骨架：

- 识别 A 股交易时段（北京时间）
- 盘中按频率轮询标的（默认 `defaultUniverse`）
- 收盘后自动生成 EOD review（复盘摘要 + 参数建议）
- 可选择是否自动审批（默认关闭，建议先人工）

### 一键启动整套（bridge + orchestrator）

```bash
cd "/Users/charles/Documents/New project"
npm run lab
```

> 这会在同一个终端里前台跑 orchestrator，并在后台带起 bridge。

### 启动自动巡航

新开一个终端：

```bash
cd "/Users/charles/Documents/New project"
npm run autopilot:start
```

查看状态：

```bash
npm run autopilot:status
```

手动触发一次巡航（便于测试）：

```bash
npm run autopilot:tick
```

停止巡航：

```bash
npm run autopilot:stop
```

### OpenClaw 侧怎么用（推荐）

- 日常聊天 / 询问状态：OpenClaw Dashboard
- 执行动作：调用本地 `/webhooks/openclaw`
- 巡航状态：`GET /api/autopilot/status`
- 收盘复盘：`GET /api/reviews` 或 `POST /api/autopilot/review`

也可以直接走 OpenClaw webhook 动作（不用命令行）：

```bash
curl -X POST http://127.0.0.1:8787/webhooks/openclaw -H 'Content-Type: application/json' -d '{"action":"AUTOPILOT_STATUS"}'
curl -X POST http://127.0.0.1:8787/webhooks/openclaw -H 'Content-Type: application/json' -d '{"action":"AUTOPILOT_START"}'
curl -X POST http://127.0.0.1:8787/webhooks/openclaw -H 'Content-Type: application/json' -d '{"action":"AUTOPILOT_TICK"}'
curl -X POST http://127.0.0.1:8787/webhooks/openclaw -H 'Content-Type: application/json' -d '{"action":"AUTOPILOT_REVIEW"}'
```

### 当前限制（实话实说）

- 盘中市场数据现在还是“模拟市场生成器 + 适配器信息”，不是实时报价接口
- `TradingAgents + GLM` 仍可能超时后 fallback
- 所以现在是“自动化骨架已成”，下一步要接真实数据源和更稳的模型路径

## 真实分钟数据（优先结构化，不用截图）

已内置 `AKShare proxy` 接口（Node 调 Python）：

1. 安装 AKShare（在项目虚拟环境里）

```bash
cd "/Users/charles/Documents/New project"
.venv/bin/pip install akshare
```

2. 把 `.env.local` 改成：

```bash
MARKET_DATA_PROVIDER=akshare-proxy
```

3. 重启 orchestrator（`npm run glm` 或 `npm run lab`）

4. 测试 market proxy（可选）

```bash
cd "/Users/charles/Documents/New project"
printf '{"symbol":"600519.SH"}' | .venv/bin/python3 backend/scripts/market_data_proxy.py
```

## Discord 跑通（可选，非主入口）

先在 Discord Developer Portal 创建 App + Bot，并拿到：

- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DISCORD_BOT_TOKEN`
- `DISCORD_PUBLIC_KEY`

把这些值填进 `.env.local`（不要提交到 GitHub）。

先检查配置：

```bash
cd "/Users/charles/Documents/New project"
npm run discord:check
npm run discord:whoami
```

注册 Slash Commands（会自动读取 `.env.local`）：

```bash
cd "/Users/charles/Documents/New project"
npm run discord:register:local
```

本地调试（不接公网）：

- 用 `npm run test:run` 或 `POST /webhooks/discord/commands` 模拟命令
- 先确认工作流/审批/桥接逻辑正常

接真实 Discord Interactions（需要公网 URL）：

1. 开一个隧道，把公网 URL 转发到 `http://127.0.0.1:8787`
2. 在 Discord Developer Portal -> `General Information` 中填写：
   - `Interactions Endpoint URL = https://你的域名/webhooks/discord/interactions`
3. 保存成功后，用 Discord 客户端执行 `/status`、`/run`

按钮审批说明：

- `/run` 返回的消息会带 `Approve` / `Reject` 按钮
- 按钮点击后会走同一个 `interactions` 回调
