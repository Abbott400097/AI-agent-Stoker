# AI-agent-Stoker (A-Share AI Trading Lab Prototype) / A股 AI 交易实验系统原型

## 中文简介
这是一个以 `OpenClaw` 为主控入口的本地交易系统原型，当前用于 **A股模拟盘验证**，目标不是直接承诺收益，而是验证一套可以迁移到其他市场（尤其美股）的自动化交易系统底盘。

当前项目重点是：
- 自动调度（盘中巡航 / 收盘复盘）
- 真实分钟数据接入（AKShare）
- 指标引擎（盘中主决策）
- 风控 / 审批 / 账本 / 模拟执行桥接
- OpenClaw 控制入口 + 本地可视化控制台

项目已经从“概念讨论”推进到“可运行联调系统”。

## English Summary
This repository is a local trading-system prototype with `OpenClaw` as the control entry. It is currently used for **A-share paper-trading validation**, with the long-term goal of building a reusable automated trading platform foundation that can later migrate to other markets (especially US equities).

The current focus is:
- Automated scheduling (intraday autopilot + end-of-day review)
- Real minute data ingestion (AKShare)
- Indicator engine (primary intraday decision logic)
- Risk controls / approvals / ledger / simulated execution bridge
- OpenClaw control endpoint + local visualization console

This project has moved from concept discussion into a runnable integration prototype.

---

## 当前定位 / Current Positioning

### 中文
这个项目 **不是** “让 LLM 自由发挥自动炒股”的黑箱机器人。

当前定位是：
- `盘中主逻辑`：真实数据 + 指标 + 规则风控（快速、稳定、可解释）
- `LLM/TradingAgents`：辅助层（复盘、解释、策略讨论），盘中默认降级/禁用
- `OpenClaw`：控制与工作流入口
- `Bridge`：模拟执行（后续可替换为东方财富/同花顺/通达信桥接器）

### English
This project is **not** a “black-box LLM that trades by itself.”

Current positioning:
- `Intraday core logic`: real data + indicators + risk rules (fast, stable, explainable)
- `LLM/TradingAgents`: auxiliary layer (review, explanation, strategy discussion), disabled/degraded by default during intraday flow
- `OpenClaw`: control and workflow entry point
- `Bridge`: simulated execution (can later be replaced by Eastmoney / THS / TDX bridges)

---

## 已实现内容 / Implemented Features

### 1) OpenClaw 主入口 / OpenClaw Primary Entry
- `POST /webhooks/openclaw`
- 支持动作 / Supported actions:
  - `RUN`, `STATUS`, `APPROVE`, `REJECT`, `LIST`
  - `AUTOPILOT_START`, `AUTOPILOT_STOP`, `AUTOPILOT_STATUS`, `AUTOPILOT_TICK`, `AUTOPILOT_REVIEW`
  - `REVIEWS`, `PORTFOLIO`
  - `SCREENER_*`（已实现但默认可选关闭 / implemented but optional and disabled by default）

### 2) 自动巡航（Autopilot）
- 识别中国市场交易时段（北京时间）
- 盘中自动轮询
- 收盘后复盘（或手动触发）
- 状态接口：
  - `GET /api/autopilot/status`
  - `POST /api/autopilot/start|stop|tick|review`

### 3) 数据层（Market Data Layer）
- `AKShare` 真实分钟数据代理（`akshare-proxy`）
- 自动回退到 `mock`（当真实源不可用时）
- 分钟数据清洗：
  - 过滤异常/脏行（如 `open=0`）
  - 尽量使用最新交易日数据，避免混入历史日

### 4) 指标引擎（Indicator Engine）
当前内置（盘中主逻辑使用）：
- `MA5/MA10/MA20`
- `RSI14`
- `ATR14`
- `量比（volume ratio）`
- 趋势/动量/流动性等评分
- 综合分 `composite`

### 5) 风控与账本（Risk + Ledger）
- A股规则基础约束（T+1、100股一手等）
- 审批后执行（默认）
- 持仓/现金/成交记录
- 账本落账优先使用真实回执 `fillPrice`

### 6) 执行桥接（Execution Bridge）
- 本地模拟桥接服务（stub）
- 支持订单回执记录
- 协议逐步抽象，为后续兼容：
  - 东方财富
  - 同花顺
  - 通达信

### 7) 可视化（Quick UI）
- 本地页面：`/openclaw-console`
- 用于渲染 webhook 返回里的 `visual` / `openclawView`
- 提供中英切换（ZH/EN）
- 适合作为“快方案”控制台，不依赖 OpenClaw 官方前端插件机制

---

## 当前架构（简化）/ Current Architecture (Simplified)

```text
OpenClaw / Local UI
        |
        v
/webhooks/openclaw
        |
        v
Orchestrator (workflow / risk / approvals / ledger)
        |                     \
        |                      \-> TradingAgents (auxiliary, often disabled intraday)
        |
        +-> Market Data Provider (AKShare / mock / http-json)
        +-> Indicator Engine (primary intraday logic)
        +-> Bridge Client (sim now; replaceable later)
```

---

## 运行方式（当前）/ How to Run (Current)

### 中文
1. 启动主服务（orchestrator + bridge）
```bash
cd "/Users/charles/Documents/New project"
npm run lab
```

2. 启动 autopilot（可选）
```bash
cd "/Users/charles/Documents/New project"
npm run autopilot:start
```

3. 打开本地可视化控制台
- [http://127.0.0.1:8787/openclaw-console](http://127.0.0.1:8787/openclaw-console)

### English
1. Start the main services (orchestrator + bridge)
```bash
cd "/Users/charles/Documents/New project"
npm run lab
```

2. Start autopilot (optional)
```bash
cd "/Users/charles/Documents/New project"
npm run autopilot:start
```

3. Open the local visual console
- [http://127.0.0.1:8787/openclaw-console](http://127.0.0.1:8787/openclaw-console)

---

## 关键取舍 / Key Decisions

### 中文
1. **盘中不用 TradingAgents 做主决策**
- 原因：`TradingAgents + GLM` 常超时，影响盘中响应速度
- 处理：盘中默认 `disabled_intraday`，保留为盘后辅助层

2. **指标主导，LLM辅助**
- 原因：A股盘中短线更适合规则/指标/风控驱动
- LLM 更适合解释、复盘、策略讨论

3. **OpenClaw 官方网页不做深度前端改造（当前阶段）**
- 处理：新增本地“快方案”可视化页 `/openclaw-console`

4. **盘前选股器已做，但默认关闭**
- 原因：先保证主流程稳定可用，再逐步开启增强模块

### English
1. **Do not use TradingAgents as the intraday decision engine**
- Reason: `TradingAgents + GLM` often times out and hurts intraday responsiveness
- Decision: default to `disabled_intraday`; keep it as post-close/auxiliary analysis

2. **Indicators first, LLM second**
- Reason: A-share intraday behavior is better served by rules/indicators/risk controls
- LLM is better for explanation, review, and strategy discussion

3. **No deep OpenClaw frontend plugin work (for now)**
- Decision: add a local “fast path” visualization page at `/openclaw-console`

4. **Premarket screener is implemented but disabled by default**
- Reason: stabilize the main flow first, then enable enhancement modules

---

## 当前已知问题 / Known Issues (Current)

### 中文
- `TradingAgents + GLM` 盘中已默认禁用（这是设计选择，不是 bug）
- `screener`（盘前选股）默认关闭，需要显式开启配置
- 执行桥接目前仍是模拟 stub，不是券商/终端真实下单桥
- OpenClaw Dashboard 本身不会自动渲染本项目的 `visual` 字段（因此有本地控制台）

### English
- `TradingAgents + GLM` is disabled for intraday use by default (design choice, not a bug)
- The premarket screener is implemented but disabled by default and must be enabled explicitly
- Execution bridge is still a simulation stub, not a live broker/terminal bridge
- OpenClaw Dashboard does not natively render this project’s `visual` payloads (hence the local console)

---

## 下一步方向（未定，保留）/ Next Directions (Open / Preserved for Future)

### 中文
当前分支用于 **保留阶段性架构和思路**，后续可能沿多个方向演进：
- 方向A：盘前选股（多周期 D/W/M + 指标）作为主逻辑
- 方向B：通达信/同花顺风格策略包（类似 skills 的策略模块）
- 方向C：真实桥接器（东方财富/同花顺/通达信）
- 方向D：迁移到美股自动化交易框架

### English
This branch is intended to **preserve the current architecture and reasoning trail**. Future work may branch into several directions:
- Path A: premarket screener (multi-timeframe D/W/M + indicators) as the main logic
- Path B: TDX/THS-style strategy packs (similar to “skills” for strategy modules)
- Path C: real execution bridges (Eastmoney / THS / TDX)
- Path D: migrate the platform foundation to US equities automation

---

## 过程记录 / Process Log
详细的中英双语过程记录（目标、问题、改动、取舍、阶段总结）见：

- [`docs/PROJECT_WORKFLOW_BILINGUAL.md`](./docs/PROJECT_WORKFLOW_BILINGUAL.md)

