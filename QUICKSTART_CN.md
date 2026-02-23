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
