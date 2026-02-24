# 项目过程记录（中英双语）/ Project Workflow Log (Bilingual)

## 0. 目的 / Purpose

### 中文
这份文档用于记录本项目从想法到当前原型的演进过程，确保后续回看时能回答：
- 当时目标是什么？
- 为什么这样改？
- 哪些地方踩坑了？
- 当前版本实际能做什么？
- 下一步为什么可能换方向？

### English
This document records how the project evolved from an idea into the current prototype, so future review can answer:
- What was the goal at each stage?
- Why were certain changes made?
- What problems were encountered?
- What can the current version actually do?
- Why might the next direction change?

---

## 1. 初始目标（用户意图）/ Initial Goal (User Intent)

### 中文
用户最初希望做一个：
- A股方向
- 多 agent 协作
- 能在 OpenClaw 或聊天渠道里协作、复盘、讨论策略
- 最终能对接东方财富模拟盘进行买卖
- 希望尽可能自动化、甚至接近全自动

同时也希望系统能够：
- 盘中动态观察市场
- 收盘后复盘并“自我学习”
- 后续支持更强执行（同花顺/通达信/美股）

### English
The original goal was to build a system that:
- targets A-shares
- supports multi-agent collaboration
- can coordinate, review, and discuss strategies via OpenClaw or chat-like channels
- can eventually connect to Eastmoney paper trading for simulated orders
- is as automated as possible (ideally close to fully automated)

The user also wanted:
- dynamic intraday market observation
- end-of-day review and “self-learning”
- future compatibility with stronger execution paths (THS / TDX / US equities)

---

## 2. 早期路线选择 / Early Route Selection

### 中文
项目前期调研了两类 GitHub 项目：
- `HKUDS/AI-Trader`
- `TauricResearch/TradingAgents`

当时结论：
- `TradingAgents` 适合“多 agent 研究/辩论/工作流”
- `AI-Trader` 适合借鉴 A股规则与结构
- 真正执行（东方财富模拟盘）应单独桥接，不应把账号登录直接塞进 agent 主流程

### English
Early exploration focused on two GitHub projects:
- `HKUDS/AI-Trader`
- `TauricResearch/TradingAgents`

Initial conclusion:
- `TradingAgents` is good for multi-agent research/debate/workflow structures
- `AI-Trader` is useful as a reference for A-share rules and structure
- Actual execution (Eastmoney paper trading) should be isolated in a separate bridge rather than embedded directly into the agent flow

---

## 3. 从“网页Demo”到“后端骨架” / From “Web Demo” to Backend Skeleton

### 中文
最开始有一个前端实验页面（模拟交易实验台），但很快发现这不足以承载用户想要的多 agent 工作流和执行链路，于是转向构建本地后端：

构建了：
- `orchestrator`（工作流编排）
- `command_router`（RUN/APPROVE/REJECT/STATUS/LIST）
- `portfolio_ledger`（持仓/现金/成交）
- `bridge_client` + 本地 bridge stub（执行回执）

这一步把项目从“页面原型”升级成“可运行的交易系统骨架”。

### English
The project initially had a frontend simulation page, but it quickly became clear this was insufficient for the desired multi-agent workflow and execution pipeline. The project shifted to a local backend:

Built components:
- `orchestrator` (workflow orchestration)
- `command_router` (RUN/APPROVE/REJECT/STATUS/LIST)
- `portfolio_ledger` (positions/cash/trades)
- `bridge_client` + local bridge stub (execution receipts)

This was the point where the project evolved from a “page prototype” into a “runnable trading-system skeleton.”

---

## 4. OpenClaw vs Discord 的取舍 / OpenClaw vs Discord Tradeoff

### 中文
曾经实现过 Discord 命令与审批入口，但后续用户明确决定：
- **不用 WhatsApp**
- **Discord 不是主入口**
- **OpenClaw 才是主入口**

因此项目最终切换为：
- `OpenClaw` = 主控 / 指令入口
- `Discord` = 保留代码但不作为主路径

### English
Discord commands and approval entry points were implemented at one stage, but the user later decided:
- **No WhatsApp**
- **Discord is not the primary interface**
- **OpenClaw is the primary interface**

So the project ultimately settled on:
- `OpenClaw` = primary control and command entry
- `Discord` = code retained, but no longer the main path

---

## 5. TradingAgents 的定位变化 / TradingAgents Positioning Shift

### 中文
一开始希望 `TradingAgents + GLM` 能参与主逻辑决策，但实际联调中暴露出问题：
- 响应慢
- 经常超时
- 盘中会拖慢整条链路

项目后来明确重构：
- `盘中主逻辑`：真实数据 + 指标 + 规则风控
- `TradingAgents`：辅助层（盘后分析/复盘/解释），盘中默认禁用 `disabled_intraday`

这是一个非常重要的架构修正。

### English
Initially, `TradingAgents + GLM` was expected to contribute to the main decision logic, but integration exposed key issues:
- slow response
- frequent timeouts
- intraday chain slowdown

The architecture was later explicitly refactored:
- `Intraday core`: real data + indicators + risk rules
- `TradingAgents`: auxiliary layer (post-close analysis/review/explanations), disabled by default for intraday (`disabled_intraday`)

This was a major and important architectural correction.

---

## 6. 数据层演进：Mock -> AKShare 真分钟数据 / Data Layer Evolution: Mock -> Real AKShare Minute Data

### 中文
项目最初使用 `mock` 市场数据以便快速搭框架，但用户明确要求“动态盘中数据”，于是加入了：
- `market_data_provider`
- `AKShare Python proxy`
- 指标引擎对真实分钟K线计算

在接入过程中遇到问题：
1. 返回 `source=unknown`
2. 混入历史旧日期分钟数据
3. 存在脏数据行（`open=0`）

修复后：
- 正确透传 `source = akshare-proxy`
- 优先保留最新交易日分钟数据
- 过滤异常数据行

### English
The project started with `mock` market data to build the framework quickly, but the user explicitly required dynamic intraday data, which led to:
- `market_data_provider`
- an `AKShare` Python proxy
- indicator calculations over real minute bars

Problems encountered during integration:
1. `source=unknown` returned
2. mixed minute rows from older dates
3. invalid rows (`open=0`)

After fixes:
- `source = akshare-proxy` is passed through correctly
- latest trading date rows are preferred
- invalid rows are filtered out

---

## 7. Autopilot（盘中/盘后）/ Autopilot (Intraday / EOD)

### 中文
为了支持“自动巡航 + 收盘复盘”，引入了 `autopilot`：
- 北京时间市场时钟判断（盘前/早盘/午休/午盘/收盘后）
- 自动 tick
- 收盘复盘
- 参数建议（轻量“自我升级”）

后续又扩展了：
- `AUTOPILOT_*` OpenClaw 控制动作
- `REVIEWS` / `PORTFOLIO`

### English
To support “autopilot + end-of-day review,” an `autopilot` module was introduced:
- China market clock session detection (preopen/morning/lunch/afternoon/postclose)
- automatic ticks
- EOD reviews
- parameter suggestions (lightweight “self-upgrade”)

It was later extended with:
- `AUTOPILOT_*` OpenClaw control actions
- `REVIEWS` / `PORTFOLIO`

---

## 8. 盘前选股器（可选模块）/ Premarket Screener (Optional Module)

### 中文
用户提出了一个关键修正：
- 分钟线不应该承担“全市场选股”主任务
- 真正选股逻辑应更依赖多周期（日/周/月）和指标体系

为此项目先实现了一个轻量 `screener` 骨架：
- 推荐候选池（scored candidates）
- 手动添加/删除股票
- 可写入 autopilot 巡航池

但根据用户决策：
- 目前 `screener` 默认关闭（`SCREENER_ENABLED=false`）
- 等主流程进一步稳定再开启验证

### English
The user made an important correction:
- minute bars should not be the primary mechanism for whole-market stock selection
- true stock selection should rely more on multi-timeframe (daily/weekly/monthly) logic and indicators

A lightweight `screener` module was implemented as a foundation:
- scored candidate recommendations
- manual add/remove symbols
- optional auto-apply to the autopilot universe

But per user decision:
- the screener is currently disabled by default (`SCREENER_ENABLED=false`)
- it will be validated later after the main workflow is further stabilized

---

## 9. OpenClaw 可视化问题与快方案 / OpenClaw Visualization Problem and Fast Path

### 中文
项目已在 webhook 返回里加入 `visual / openclawView` 结构，但用户反馈：
- 在 OpenClaw 网页里“看不到真正可视化”

根本原因：
- OpenClaw Dashboard 不会自动渲染任意 webhook 返回中的自定义可视化协议

因此采用“快方案”：
- 新增本地可视化控制台页面：`/openclaw-console`
- 同源调用 `/webhooks/openclaw`
- 渲染 `visual / openclawView`
- 新增中英切换（ZH/EN）

这一步大幅提升了可读性和演示体验。

### English
The project added `visual / openclawView` payloads to webhook responses, but the user reported:
- no actual visual rendering inside the OpenClaw web UI

Root cause:
- OpenClaw Dashboard does not automatically render arbitrary custom visualization payloads from webhook responses

So a “fast path” solution was adopted:
- a local visual console page at `/openclaw-console`
- same-origin calls to `/webhooks/openclaw`
- rendering of `visual / openclawView`
- bilingual UI switch (ZH/EN)

This significantly improved readability and demo usability.

---

## 10. 安全与运行问题（踩坑记录）/ Security and Runtime Issues (Pitfalls)

### 中文
在实际联调过程中遇到的一些问题：

1. **API key 泄露风险**
- 用户多次把 GLM key 粘贴到聊天中
- 已提醒应立即轮换 / 重建

2. **端口冲突**
- `8099` 被占用，后来改用 `8100`

3. **Mac 终端使用门槛**
- 用户从 Windows 转到 macOS，不熟悉 `zsh` / 多终端 / 当前目录
- 后续统一使用“终端 A / B / C”分步指令方式

4. **OpenClaw gateway 配对/401混淆**
- OpenClaw 自身 gateway / provider 配置问题与本项目 webhook 401 一度混淆
- 后来确认本项目 webhook 是正常的

5. **本地状态污染**
- `.runtime/state.json` 导致旧持仓影响新测试（如 `cash_insufficient`）
- 已新增 `POST /api/reset`

### English
Several practical integration issues appeared:

1. **API key leakage risk**
- GLM keys were pasted into chat multiple times
- User was advised to rotate/recreate them immediately

2. **Port conflicts**
- `8099` was occupied, later switched to `8100`

3. **Mac terminal learning curve**
- The user came from Windows and was not yet comfortable with `zsh` / multi-terminal flow / working directory management
- Instructions were standardized into “Terminal A / B / C” steps

4. **OpenClaw gateway pairing / 401 confusion**
- OpenClaw gateway/provider auth issues were initially confused with this project’s webhook
- Later confirmed the project webhook itself was working correctly

5. **Local state pollution**
- `.runtime/state.json` caused old positions to affect new tests (e.g., `cash_insufficient`)
- `POST /api/reset` was added

---

## 11. 为什么项目仍然有价值 / Why the Project Is Still Valuable

### 中文
尽管用户一度怀疑“只是借别人数据搭平台是否没意义”，当前结论是：
- 这个项目的价值不在于“马上自动赚钱”
- 而在于它已经形成了一个 **可复用交易系统底盘**

可复用的部分包括：
- 调度
- 风控
- 账本
- 执行桥接
- 复盘流程
- OpenClaw 控制入口
- 本地可视化

未来即使策略逻辑换成：
- 通达信/同花顺风格策略包
- 多周期选股
- 美股量化策略

这些基础设施仍然能继续用。

### English
Even though the user understandably questioned whether “building a platform on top of someone else’s data” is useful, the current conclusion is:
- the value is not in “making money immediately”
- the value is in having built a **reusable trading-system foundation**

Reusable parts include:
- scheduling
- risk control
- ledger
- execution bridge
- review workflow
- OpenClaw control entry
- local visualization

Even if the strategy logic later shifts to:
- TDX/THS-style strategy packs
- multi-timeframe stock selection
- US equities quant strategies

this infrastructure remains useful.

---

## 12. 当前分支的意义 / Purpose of This Branch

### 中文
当前分支（`preserve-current-arch`）用于：
- 保留当前阶段的可运行架构
- 保留关键取舍与演进轨迹
- 为后续新方向实验提供稳定起点

它不是最终方案，而是一个 **可回溯的里程碑分支**。

### English
The current branch (`preserve-current-arch`) exists to:
- preserve the runnable architecture of the current phase
- preserve key tradeoffs and the evolution trail
- provide a stable starting point for new experimental directions

It is not the final architecture, but a **traceable milestone branch**.

---

## 13. 下一步（暂未定，保留思考）/ Next Steps (Open, Intentionally Unfinalized)

### 中文
用户目前正在重新思考方向，暂不强行推进某条路线。后续可能方向包括：
- 通达信/同花顺风格指标与公式策略（策略包化）
- 盘前选股（多周期日周月主导）+ 盘中分钟执行
- 美股自动化交易迁移（复用现有底盘）

### English
The user is intentionally re-evaluating strategy and does not want to force the next direction yet. Possible next directions include:
- TDX/THS-style indicator + formula strategies (as modular strategy packs)
- premarket stock selection (multi-timeframe daily/weekly/monthly) + intraday minute execution
- migration to US equities automation using the existing platform foundation

