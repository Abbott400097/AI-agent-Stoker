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

## 命令注册（推荐一键方式）

先填项目根目录的 `.env.local`：

- `DISCORD_APPLICATION_ID`
- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_PUBLIC_KEY`

然后在项目根目录执行：

```bash
npm run discord:check
npm run discord:register:local
```

查看当前读取到的 Discord 配置（会打码）：

```bash
npm run discord:whoami
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

## 接入真实 Discord Interactions（公网回调）

Discord 不会请求你的 `127.0.0.1`，需要一个公网 URL 转发到本机：

- 本地目标：`http://127.0.0.1:8787/webhooks/discord/interactions`

你可以用任意隧道工具（如 `cloudflared` / `ngrok`）。拿到公网 URL 后，在 Discord Developer Portal 的 `General Information` 页面填写：

- `Interactions Endpoint URL = https://your-public-host/webhooks/discord/interactions`

保存通过后，再在 Discord 中测试：

- `/status`
- `/run symbol:600519.SH mode:hybrid`
