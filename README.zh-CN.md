# CodexBro 中文说明

[English README](README.md)

像 SaaS 一样管理本地 Codex：网页派发任务，本机执行，过程可审计。

CodexBro 是一个实验性的本地 Agent 执行控制台，用来把网页端的任务管理、审批、日志、文件和审计能力连接到可信的本地 Codex worker。

它不是 OpenAI 官方项目，也不隶属于 OpenAI。Codex、ChatGPT、OpenAI 是其各自所有者的商标。

![CodexBro 控制台](assets/verification/ui-smoke-dashboard.png)

## 这个项目解决什么问题

很多团队希望有一个网页界面来派发 Agent 任务，但又不想把真实代码、浏览器登录态、本地文件和桌面操作权限交给远端服务。CodexBro 的思路是：

- 网页端负责登录、工作区、任务、文件、日志、审批、审计和结果展示。
- 本地 worker 运行在用户自己的机器上，按 allowlist 执行 Shell、Codex、Browser、Computer 等任务。
- 高风险动作通过审批门禁暂停，用户确认后再继续。
- 任务过程、结果和产物回传到 Web 对话里，便于客户或团队查看。

你可以把它理解成一个面向 Codex-style agents 的本地执行控制平面。

## 当前成熟度

CodexBro 目前是 early-stage OSS reference implementation。

比较稳定的部分：

- Web 控制台
- 本地 worker 绑定和 token 生命周期
- Shell/Codex 任务派发
- 工作区文件和任务附件
- 任务日志、审批、取消、重试、stale recovery
- SQLite 持久化
- 审计记录
- 本地 E2E 和 UI smoke 测试

实验性的部分：

- Codex Browser plugin 派发
- Codex Computer Use 派发
- `codex app-server` native runtime 探测
- Codex Desktop bridge
- CuaDriver / macOS 桌面控制链路

这些能力依赖本机 Codex、Codex Desktop、Chrome、CuaDriver 和系统权限状态，不应该被当成稳定公共 API。

## 功能概览

- 中文优先的 Web 控制台，支持中英文切换。
- SaaS 风格登录和平台管理员客户创建流程。
- 工作区、成员角色、worker、任务、文件、审计和设置页面。
- 任务对话界面：左侧任务历史，主区域显示任务请求、worker 反馈、审批、结果和产物。
- 本地 worker CLI：支持一次性 pairing token、持久 worker token、解绑和 token revoke。
- 执行边界：`--allowed-dir` 限定本地可操作目录，`--allowed-mode` 限定任务模式。
- 任务模式：Shell、Codex、Browser、Computer。
- 审批门禁：危险 Shell 命令和需要用户确认的操作会暂停。
- SQLite 默认存储，也保留 JSON fallback。
- 任务产物目录：任务生成的文件可以自动回传到 Web 端。
- 自动化验证：`check`、`build`、E2E、UI smoke、可选 Desktop E2E。

## 截图

这些截图来自本地 smoke 数据，不包含真实客户信息、密钥或私有工作区内容。

![CodexBro 移动端任务视图](assets/verification/ui-smoke-mobile.png)

## 快速启动

```bash
npm ci
npm run dev
```

打开：

```text
http://localhost:5173
```

默认本地管理员账号：

```text
founder@codexbro.local
codexbro-demo
```

登录后，在管理后台创建客户账号，再用客户账号进入工作区并创建 worker pairing token。

启动本地 worker：

```bash
npm run worker -- \
  --server http://localhost:4317 \
  --pairing-token <token> \
  --token-file .codexbro/worker-token.json \
  --allowed-dir /path/to/project
```

如果只想让 worker 接 Shell 任务：

```bash
npm run worker -- \
  --server http://localhost:4317 \
  --pairing-token <token> \
  --token-file .codexbro/worker-token.json \
  --allowed-dir /path/to/project \
  --allowed-mode shell
```

## Desktop / Browser / Computer 能力

CodexBro 支持实验性的本机 Browser/Computer 派发路径。推荐先运行：

```bash
npm run doctor:desktop
```

如需真实前台 smoke：

```bash
CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true npm run doctor:desktop -- --smoke
```

注意：

- Desktop bridge 可能会短暂把 Codex Desktop 切到前台。
- CuaDriver 需要 macOS Accessibility 和 Screen Recording 权限。
- Browser/Computer 任务可能接触真实浏览器登录态和桌面应用。
- 登录、验证码、扫码、安全验证、发布、私信、付款、账号设置等动作应该保持人工确认边界。

## 开发与验证

```bash
npm ci
npm run check
npm run build
npm run test:e2e
npm run test:ui
```

可选 macOS 本地验收：

```bash
npm run test:desktop-e2e
```

GitHub Actions 当前运行稳定核心检查：

- `npm ci`
- `npm run check`
- `npm run build`

完整 E2E 和 UI smoke 已在维护者本机通过；GitHub Linux runner 上的 deterministic 适配在 issue 中跟踪。

## 安全边界

CodexBro 会让本地机器执行任务，所以它是安全敏感项目。使用时请注意：

- 不要提交 `.codexbro/`。
- 不要提交 SQLite 数据库、worker token、日志、任务产物或真实用户文件。
- 不要提交 `.env` 里的真实密钥。
- worker 应使用最小可用 `--allowed-dir`。
- 生产环境应修改默认管理员邮箱和密码。
- Browser/Computer 能力要明确告知用户并保留确认流程。
- 不要用它绕过登录、验证码、平台风控、支付确认或权限限制。

更多内容见 `SECURITY.md`。

## 项目结构

```text
packages/web      React/Vite Web 控制台
packages/server   Express API、SQLite、任务队列、worker 注册、SSE
packages/worker   本地 worker CLI 和执行器
packages/shared   共享协议和类型
scripts/          E2E、UI smoke、Desktop bridge、doctor 工具
docs/             架构、部署、本地设置、项目范围、维护说明
```

## 更多文档

- `docs/DEMO.md`：5 步本地演示流程。
- `docs/FAQ.zh-CN.md`：中文常见问题。
- `docs/THREAT_MODEL.md`：本地执行安全模型和信任边界。
- `docs/COMPARISON.md`：和 CI runner、远程桌面、普通 Chat UI 的区别。

## 开源许可证

CodexBro 使用 AGPL-3.0-or-later。

这意味着你可以学习、自用、修改和分发；如果你基于修改版提供网络服务，AGPL 可能要求你向该服务用户提供对应源码。

如果你希望在闭源商业产品或服务中使用 CodexBro，且不想承担 AGPL 义务，可以联系维护者讨论单独商业授权。见 `COMMERCIAL_LICENSE.md`。

## 参与贡献

欢迎优先从以下方向贡献：

- 中文/英文文档改进
- Quick Start 排错说明
- worker allowlist 示例
- UI 文案和可用性改进
- GitHub Actions 中的 E2E/UI smoke 稳定化
- 安全边界和审批流程审查

贡献前请阅读 `CONTRIBUTING.md`。
