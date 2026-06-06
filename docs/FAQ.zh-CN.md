# CodexBro 常见问题

## CodexBro 是 OpenAI 官方项目吗？

不是。CodexBro 是一个非官方开源项目，不隶属于 OpenAI，也不代表 OpenAI。它围绕 Codex-style agent 工作流做本地执行控制台和 worker 编排。

## CodexBro 会把我的代码上传到云端吗？

CodexBro 的设计目标是让执行留在本地 worker。Web 控制台会把任务、日志、工作区文件、审批和产物存在 CodexBro server 里；本地 worker 只在你配置的 `--allowed-dir` 范围内执行任务。

如果你把 CodexBro server 部署在远端，上传到工作区的文件会存到该 server。因此请把 server 当成需要信任和保护的控制平面。

## worker token 存在哪里？

默认存在：

```text
.codexbro/worker-token.json
```

这个文件不应该提交到 Git。worker 被解绑后，服务端会 revoke 对应 token，未完成任务也会失败。

## `.codexbro/` 目录可以提交吗？

不可以。`.codexbro/` 可能包含本地数据库、worker token、任务工作区、产物、日志和临时文件。它已经在 `.gitignore` 中，但发布前仍应检查。

## Browser / Computer 模式安全吗？

这些模式是实验性的，需要额外谨慎。它们可能接触真实浏览器登录态、桌面窗口和本地应用。

推荐边界：

- 保持 `--allowed-dir` 最小化。
- 使用 `--allowed-mode` 限制 worker 能接的任务。
- 登录、验证码、扫码、安全验证、评论、私信、发布、付款、删除、账号设置等动作必须保留人工确认。
- 遇到权限不足或页面不可访问时，应停止并说明原因。

## 为什么使用 AGPL？

CodexBro 是一个网络控制台和本地执行基础设施。AGPL 可以保证基于它修改并作为网络服务提供时，用户仍有获得对应源码的权利。

如果组织想把 CodexBro 放进闭源商业产品或服务里，并且不想承担 AGPL 义务，可以联系维护者讨论单独商业授权。

## 能直接用于生产吗？

不建议直接把当前版本作为无审计的生产系统。它更适合作为 early-stage OSS reference implementation，用来学习和验证：

- 本地 worker 绑定
- 任务队列
- 审批门禁
- 文件和产物回传
- 审计和日志
- 本地 Codex/Browser/Computer 能力接入

生产部署前至少需要补充认证加固、部署隔离、备份、监控、密钥管理、访问策略和安全审查。

## 为什么 GitHub CI 暂时只跑 check/build？

`npm run test:e2e` 和 `npm run test:ui` 已经在维护者本机通过。GitHub Linux runner 上还需要额外适配，避免 Playwright、临时进程和 native readiness 检查导致不稳定。

相关跟踪 issue：

- `CI hardening: adapt full E2E suite for GitHub Linux runners`
- `CI hardening: make UI smoke deterministic on GitHub runners`

## 我应该从哪里开始贡献？

推荐从以下方向开始：

- Quick Start 排错文档
- worker allowlist 示例
- 截图说明和隐私检查
- UI smoke / E2E 的 GitHub runner 适配
- 安全边界和审批流程文档

