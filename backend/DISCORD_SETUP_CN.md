# Discord 接入（本项目）

本项目使用 Discord 作为唯一消息入口（命令 + 审批按钮），主工作流仍在本地 orchestrator 执行。

## 你需要的东西

- Discord Developer Portal 创建的 Application
- Bot Token
- Application Public Key（用于 interactions 签名校验）
- 一个测试服务器（Guild）ID

## 推荐接法（最稳）

- `Discord Interactions Endpoint` -> 指向你的服务：`https://your-domain/webhooks/discord/interactions`
- 服务端校验签名后，把 slash command / 按钮动作转给本地命令路由
- 决策消息用 embed + 按钮（Approve / Reject）

## 本地开发（先不暴露公网）

1. 启动 orchestrator（本地）
2. 用 `POST /webhooks/discord/commands` 进行命令模拟
3. 确认逻辑正确后，再用隧道（如 cloudflared/ngrok）暴露 `/webhooks/discord/interactions`

## 命令注册

先填 `.env`：

- `DISCORD_APPLICATION_ID`
- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`

然后执行：

```bash
node backend/scripts/register_discord_commands.mjs
```

## 已支持命令

- `/run symbol:600519.SH mode:hybrid`
- `/status`
- `/list target:decisions`
- `/approve decision_id:<uuid>`
- `/reject decision_id:<uuid> reason:<text>`

## 按钮审批

系统会为待审批交易生成两个按钮：

- `Approve`
- `Reject`

按钮会映射到内部命令：

- `approve:<decisionId>`
- `reject:<decisionId>`

## 安全建议

- 默认保持 `manualApproval=true`
- 默认 `EASTMONEY_BRIDGE_SIMULATE=true`
- 真正接东方财富模拟盘桥接时，先只打通回执，不要直接全自动连发
