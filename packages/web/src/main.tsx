import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Computer,
  Download,
  Edit3,
  FileText,
  FolderLock,
  Globe,
  KeyRound,
  ListChecks,
  Lock,
  Play,
  Plus,
  Radio,
  Save,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
  UserCircle2,
  Workflow,
  XCircle
} from "lucide-react";
import type {
  AdminUserSummary,
  AdminUsersResponse,
  AuditEventRecord,
  AuthResponse,
  LogLevel,
  PairingTokenResponse,
  TaskArtifact,
  TaskLogRecord,
  TaskMode,
  TaskRecord,
  TaskStreamEvent,
  UserProfile,
  WorkspaceFileRecord,
  WorkspacePromptTemplateRecord,
  WorkspaceRecord,
  WorkspaceRole,
  WorkerRecord
} from "@codexbro/shared";
import "./styles.css";

const API = import.meta.env.VITE_CODEXBRO_API_URL?.replace(/\/$/, "") ?? "";

type Language = "zh" | "en";

const COPY = {
  zh: {
    loginHeadline: "像 SaaS 一样管理本地 Codex 工作。",
    loginSubtitle: "登录后连接本地 Codex，派发任务，并实时查看本机执行过程。",
    email: "邮箱",
    password: "密码",
    signIn: "登录",
    signingIn: "登录中",
    loginFailed: "登录失败",
    liveWorker: "实时本地 Codex",
    online: "在线",
    previewWorker: "本地 Codex：forkman-mac-mini",
    previewMode: "模式：Shell",
    previewStatus: "状态：正在流式输出日志",
    previewBound: "已绑定到工作区",
    previewClaimed: "任务已领取",
    previewUploaded: "结果已上传",
    tasks: "任务",
    files: "文件",
    workers: "工作机",
    admin: "管理后台",
    audit: "审计",
    settings: "设置",
    sidebarNote: "本地执行始终绑定到已连接的本地 Codex 和审批门禁。",
    tasksSubtitle: "派发任务给本地 Codex，并实时查看执行过程。",
    filesSubtitle: "像网盘一样浏览当前工作区文件，上传、查找、下载和删除。",
    workersSubtitle: "连接本地机器上的 Codex，并检查它们的执行边界。",
    adminSubtitle: "由平台管理员创建客户账号、分配客户工作区并管理账号状态。",
    auditSubtitle: "查看是谁让本地 Codex 做了什么，以及发生时间。",
    settingsSubtitle: "配置让本地执行可控可用的安全边界。",
    localWorkerOnline: "本地 Codex 在线",
    personalWorkspace: "个人工作区",
    noWorkers: "还没有连接本地 Codex",
    pairWorker: "连接本地 Codex",
    newTask: "新建任务",
    newTaskSubtitle: "选择本地 Codex 和执行模式。",
    chatHistory: "任务历史",
    taskConversation: "任务对话",
    taskConversationSubtitle: "输入任务后，本地 Codex 的领取、日志、审批和结果都会回到这里。",
    taskRequest: "任务请求",
    workerFeedback: "Codex 反馈",
    executionOverview: "执行概览",
    executionSignals: "执行信号",
    feedbackCount: "反馈",
    approvalCount: "审批",
    lastWorkerMessage: "最近消息",
    noWorkerMessage: "暂无 worker 消息",
    currentStage: "当前阶段",
    stageQueued: "排队",
    stageClaimed: "领取",
    stageExecuting: "执行",
    stageApproval: "确认",
    stageFinished: "结果",
    progressTimeline: "进度时间线",
    latestFeedback: "最新反馈",
    rawLogs: "原始日志",
    noProgressYet: "等待本地 Codex 写入阶段进度。",
    taskQueued: "任务已进入队列",
    workerClaimed: "本地 Codex 已领取任务",
    submittedToDesktop: "已提交到 Codex Desktop",
    writingResult: "正在等待结果回传",
    taskResult: "任务结果",
    taskArtifacts: "任务产物",
    workspaceFiles: "工作区文件",
    workspaceFilesSubtitle: "上传的文件只属于当前工作区，可作为任务附件给本地 Codex 使用。",
    workspaceFilesDriveSubtitle: "这些文件保存在服务器工作区里，本地 Codex 执行任务时会按需下载。",
    openWorkspaceFiles: "打开文件空间",
    uploadFile: "上传文件",
    searchFiles: "搜索文件",
    allFiles: "全部文件",
    matchingFiles: "匹配文件",
    serverStored: "服务器存储",
    fileName: "文件名",
    fileSize: "大小",
    fileUploadedAt: "上传时间",
    downloadFile: "下载",
    deleteFile: "删除",
    attachFiles: "任务附件",
    noWorkspaceFiles: "还没有上传文件。",
    attachedFiles: "已附加文件",
    conversationEmpty: "还没有任务。像和 Codex 对话一样，在下面输入你想让本机完成的工作。",
    promptPlaceholder: "输入任务，例如：检查这个项目并运行测试",
    promptTemplates: "提示词模板",
    promptTemplatesSubtitle: "先用模板组织任务，再交给本地 Codex 执行。",
    useTemplate: "使用模板",
    builtinTemplates: "内置模板",
    customTemplates: "自定义模板",
    newPromptTemplate: "新建模板",
    editPromptTemplate: "编辑模板",
    templateTitle: "模板名称",
    templateDescription: "模板说明",
    templatePrompt: "模板内容",
    templateMode: "推荐模式",
    saveTemplate: "保存模板",
    updateTemplate: "更新模板",
    cancelTemplateEdit: "取消",
    customTemplateEmpty: "还没有自定义模板。",
    customerResearchTemplate: "客户信息采集",
    customerResearchTemplateDesc: "公开资料、关键词、线索表",
    lowRiskEngagementTemplate: "低风险互动",
    lowRiskEngagementTemplateDesc: "只生成建议，人工确认后再动作",
    contentPublishTemplate: "内容发布助手",
    contentPublishTemplateDesc: "素材检查、草稿排版、发布前确认",
    modeAndWorker: "执行设置",
    sendTask: "发送任务",
    noLogsYet: "暂无 Codex 反馈；新反馈会实时出现在这里。",
    targetWorker: "本地 Codex",
    selectWorker: "选择本地 Codex",
    runMode: "执行模式",
    shell: "Shell",
    codex: "Codex",
    browser: "Codex 浏览器插件",
    computer: "Codex Computer Use",
    workingDirectory: "工作目录",
    workingDirectoryPlaceholder: "留空则使用本地 Codex 连接器进程目录",
    startTask: "开始任务",
    starting: "启动中",
    runningNow: "当前任务",
    tasksInWorkspace: (count: number) => `当前工作区 ${count} 个任务`,
    attempt: "第",
    attemptSuffix: "次",
    retryAt: "重试时间",
    createAfterPairing: "连接本地 Codex 后即可创建任务。",
    liveLogs: "实时日志",
    waitingForTask: "等待任务",
    retryTask: "重试任务",
    cancelTask: "取消任务",
    canceling: "取消中",
    requiresApproval: "需要审批",
    approvalTitle: "本地 Codex 请求你确认",
    approvalSubtitle: "只会放行下面这一项暂停动作，不会自动批准后续登录、评论、私信、发布或支付。",
    approvalBrowserComputerHint: "Browser/Computer 任务可能会操作真实网页或桌面应用；确认前请检查目标、动作和内容。",
    approvalShellHint: "Shell/Codex 任务会在你的本地机器继续执行；确认前请检查命令和目录。",
    approveOperation: "确认并继续",
    risk: "风险",
    action: "动作",
    directory: "目录",
    command: "命令",
    approve: "批准",
    waitingForOutput: "等待 Codex 输出。",
    artifacts: "产物",
    artifactsSubtitle: "Codex 返回的结果和文件。",
    completedResults: "完成后的结果会显示在这里。",
    localWorkers: "本地工作机",
    localWorkersSubtitle: "每个本地 Codex 连接器都会声明能力和本地目录边界。",
    capabilityMatrix: "能力检测",
    modeReady: "可用",
    modeBlocked: "不可用",
    selectedWorkerHealth: "当前 worker 能力",
    selectedWorkerHealthSubtitle: "切换模式前先确认这台本地 Codex 是否允许对应任务。",
    workerOnlineReady: "在线，可接任务",
    workerOffline: "离线",
    browserComputerReady: "Browser/Computer 可用",
    browserComputerNeedsSetup: "Browser/Computer 需要检查",
    lastSeen: "最后在线",
    allowed: "允许",
    unbindWorker: "解绑",
    unbindWorkerTitle: "撤销这台电脑的本地 worker token",
    nativeReadiness: "原生能力自检",
    nativeBackend: "后端",
    readinessUnknown: "未上报自检",
    recommendedWorkerCommand: "推荐启动命令",
    basicWorkerCommand: "基础启动命令",
    desktopReady: "Codex Desktop 派发已验证",
    desktopForegroundRequired: "需要允许 Codex 短暂前台",
    desktopSmokeDisabled: "Desktop Smoke 未开启",
    desktopBridgeMissing: "Desktop Bridge 不可用",
    unknownWorkspace: "未知工作区",
    noAllowlist: "未上报 allowlist",
    pairWorkerEmpty: "连接本地 Codex 后即可开始本地执行。",
    auditTrail: "审计记录",
    auditTrailSubtitle: "用户和本地 Codex 的生命周期事件。",
    auditEmpty: "用户和本地 Codex 产生动作后，审计事件会显示在这里。",
    executionGuardrails: "执行护栏",
    currentSafetyControls: "当前 MVP 安全控制。",
    guardrailAllowlist: "Shell 和 Codex 任务只能在本地 Codex 连接器 allowlist 内运行。",
    guardrailApproval: "危险 Shell 模式会在执行前暂停并等待审批。",
    guardrailAudit: "本地 Codex 连接器生命周期、任务领取、审批、完成和失败都会进入审计。",
    guardrailBrowser: "浏览器和电脑操作任务必须接入桌面 Codex 的原生 Browser 插件或 Computer Use；通道不可用时任务会明确失败。",
    guardrailWorkspace: "本地 Codex 连接器属于工作区，并且可以限制允许的任务模式。",
    guardrailRoles: "工作区角色包括 owner、admin、operator 和 viewer。",
    workerLaunch: "本地 Codex 启动",
    workerLaunchSubtitle: "连接生产机器时建议使用 allowlist。",
    desktopLaunchChecklist: "Desktop 启动检查",
    desktopLaunchChecklistSubtitle: "确认这个本地 worker 是否已经能承接 Browser 和 Computer 任务。",
    checklistConnectedWorker: "本地 worker 已连接",
    checklistDesktopBackend: "Desktop 后端已启用",
    checklistTaskModes: "Browser/Computer 模式已允许",
    checklistDesktopBridge: "Desktop Bridge 可用",
    checklistDesktopSmoke: "Desktop Smoke 已验证",
    checklistCuaDriver: "CuaDriver 权限可用",
    checklistChrome: "Chrome 通道可用",
    checklistReady: "就绪",
    checklistNeedsAttention: "需处理",
    checklistOptional: "可选",
    checklistNoWorker: "还没有 worker。先创建 pairing token 并启动本地 worker。",
    checklistUseRecommendedCommand: "使用推荐启动命令，并保持 Codex Desktop 已登录。",
    checklistAllowModes: "启动命令需要包含 --allowed-mode browser 和 --allowed-mode computer。",
    checklistSmokeHint: "开启 CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true 和 CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=true。",
    registeredWorkers: "已注册工作机",
    adminUsers: "客户账号",
    adminUsersSubtitle: "客户不能自助注册；必须由平台管理员在这里开通。",
    createCustomer: "创建客户",
    customerEmail: "客户邮箱",
    initialPassword: "初始密码",
    customerWorkspace: "客户工作区",
    createUser: "创建用户",
    creating: "创建中",
    userCreated: "客户账号已创建",
    usersEmpty: "还没有客户账号。",
    disabled: "已禁用",
    active: "可用",
    disableUser: "禁用",
    enableUser: "启用",
    resetPassword: "重置密码",
    newPassword: "新密码",
    adminRole: "管理员",
    customerRole: "客户",
    status: {
      pending: "待执行",
      running: "运行中",
      waiting_user: "等待审批",
      canceling: "取消中",
      canceled: "已取消",
      completed: "已完成",
      failed: "失败"
    }
  },
  en: {
    loginHeadline: "Local Codex work, controlled like SaaS.",
    loginSubtitle: "Sign in to connect local Codex, dispatch tasks, and watch execution stream back from your machine.",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in",
    loginFailed: "Login failed",
    liveWorker: "Live local Codex",
    online: "online",
    previewWorker: "local Codex: forkman-mac-mini",
    previewMode: "mode: shell",
    previewStatus: "status: streaming logs",
    previewBound: "bound to workspace",
    previewClaimed: "task claimed",
    previewUploaded: "result uploaded",
    tasks: "Tasks",
    files: "Files",
    workers: "Workers",
    admin: "Admin",
    audit: "Audit",
    settings: "Settings",
    sidebarNote: "Local execution stays bound to connected local Codex and approval gates.",
    tasksSubtitle: "Dispatch work to local Codex and watch the run unfold.",
    filesSubtitle: "Browse workspace files like a drive: upload, search, download, and delete.",
    workersSubtitle: "Connect Codex on local machines and inspect execution boundaries.",
    adminSubtitle: "Platform admins create customer accounts, assign customer workspaces, and manage account state.",
    auditSubtitle: "Review who asked local Codex to do what, and when.",
    settingsSubtitle: "Configure the guardrails that make local execution usable.",
    localWorkerOnline: "Local Codex online",
    personalWorkspace: "Personal workspace",
    noWorkers: "No local Codex connected yet",
    pairWorker: "Connect local Codex",
    newTask: "New task",
    newTaskSubtitle: "Choose local Codex and execution mode.",
    chatHistory: "Task history",
    taskConversation: "Task conversation",
    taskConversationSubtitle: "Ask for work once; local Codex claims, logs, approvals, and results come back here.",
    taskRequest: "Task request",
    workerFeedback: "Codex feedback",
    executionOverview: "Execution overview",
    executionSignals: "Execution signals",
    feedbackCount: "feedback",
    approvalCount: "approvals",
    lastWorkerMessage: "Latest message",
    noWorkerMessage: "No worker message yet",
    currentStage: "Current stage",
    stageQueued: "Queued",
    stageClaimed: "Claimed",
    stageExecuting: "Executing",
    stageApproval: "Confirm",
    stageFinished: "Result",
    progressTimeline: "Progress timeline",
    latestFeedback: "Latest feedback",
    rawLogs: "Raw logs",
    noProgressYet: "Waiting for local Codex to write staged progress.",
    taskQueued: "Task queued",
    workerClaimed: "Local Codex claimed the task",
    submittedToDesktop: "Submitted to Codex Desktop",
    writingResult: "Waiting for result handoff",
    taskResult: "Task result",
    taskArtifacts: "Task artifacts",
    workspaceFiles: "Workspace files",
    workspaceFilesSubtitle: "Uploaded files stay in this workspace and can be attached to local Codex tasks.",
    workspaceFilesDriveSubtitle: "Files are stored in the server workspace; local Codex downloads them when a task needs them.",
    openWorkspaceFiles: "Open file space",
    uploadFile: "Upload file",
    searchFiles: "Search files",
    allFiles: "All files",
    matchingFiles: "Matches",
    serverStored: "Server stored",
    fileName: "File name",
    fileSize: "Size",
    fileUploadedAt: "Uploaded",
    downloadFile: "Download",
    deleteFile: "Delete",
    attachFiles: "Task attachments",
    noWorkspaceFiles: "No uploaded files yet.",
    attachedFiles: "Attached files",
    conversationEmpty: "No task yet. Type what you want this machine to do, just like chatting with Codex.",
    promptPlaceholder: "Type a task, for example: inspect this project and run tests",
    promptTemplates: "Prompt templates",
    promptTemplatesSubtitle: "Start from a reusable brief, then let local Codex execute it.",
    useTemplate: "Use template",
    builtinTemplates: "Built-in templates",
    customTemplates: "Custom templates",
    newPromptTemplate: "New template",
    editPromptTemplate: "Edit template",
    templateTitle: "Template name",
    templateDescription: "Template description",
    templatePrompt: "Template prompt",
    templateMode: "Recommended mode",
    saveTemplate: "Save template",
    updateTemplate: "Update template",
    cancelTemplateEdit: "Cancel",
    customTemplateEmpty: "No custom templates yet.",
    customerResearchTemplate: "Customer research",
    customerResearchTemplateDesc: "Public profile, keywords, lead table",
    lowRiskEngagementTemplate: "Low-risk engagement",
    lowRiskEngagementTemplateDesc: "Draft suggestions only, human approves actions",
    contentPublishTemplate: "Content publishing",
    contentPublishTemplateDesc: "Asset check, post draft, confirmation before publish",
    modeAndWorker: "Run settings",
    sendTask: "Send task",
    noLogsYet: "No Codex feedback yet. New feedback will stream here.",
    targetWorker: "Local Codex",
    selectWorker: "Select local Codex",
    runMode: "Run mode",
    shell: "Shell",
    codex: "Codex",
    browser: "Codex Browser plugin",
    computer: "Codex Computer Use",
    workingDirectory: "Working directory",
    workingDirectoryPlaceholder: "Leave blank to use the local Codex connector process directory",
    startTask: "Start task",
    starting: "Starting",
    runningNow: "Running now",
    tasksInWorkspace: (count: number) => `${count} tasks in this workspace`,
    attempt: "attempt",
    attemptSuffix: "",
    retryAt: "retry at",
    createAfterPairing: "Create a task after connecting local Codex.",
    liveLogs: "Live logs",
    waitingForTask: "Waiting for a task",
    retryTask: "Retry task",
    cancelTask: "Cancel task",
    canceling: "Canceling",
    requiresApproval: "Requires approval",
    approvalTitle: "Local Codex is asking for confirmation",
    approvalSubtitle: "This only approves the paused operation below. It does not auto-approve future login, comment, DM, publish, or payment actions.",
    approvalBrowserComputerHint: "Browser/Computer tasks may act on real webpages or desktop apps; review the target, action, and content before approving.",
    approvalShellHint: "Shell/Codex tasks continue on your local machine; review the command and directory before approving.",
    approveOperation: "Confirm and continue",
    risk: "Risk",
    action: "Action",
    directory: "Directory",
    command: "Command",
    approve: "Approve",
    waitingForOutput: "Waiting for Codex output.",
    artifacts: "Artifacts",
    artifactsSubtitle: "Result and files returned by Codex.",
    completedResults: "Completed results appear here.",
    localWorkers: "Local workers",
    localWorkersSubtitle: "Each local Codex connector advertises capabilities and local directory boundaries.",
    capabilityMatrix: "Capability check",
    modeReady: "Ready",
    modeBlocked: "Blocked",
    selectedWorkerHealth: "Selected worker capability",
    selectedWorkerHealthSubtitle: "Check whether this local Codex can accept the selected task mode.",
    workerOnlineReady: "Online, can accept work",
    workerOffline: "Offline",
    browserComputerReady: "Browser/Computer ready",
    browserComputerNeedsSetup: "Browser/Computer needs setup",
    lastSeen: "last seen",
    allowed: "allowed",
    unbindWorker: "Unbind",
    unbindWorkerTitle: "Revoke this machine's local worker token",
    nativeReadiness: "Native readiness",
    nativeBackend: "Backend",
    readinessUnknown: "No readiness reported",
    recommendedWorkerCommand: "Recommended launch command",
    basicWorkerCommand: "Basic launch command",
    desktopReady: "Codex Desktop dispatch verified",
    desktopForegroundRequired: "Allows Codex to briefly foreground",
    desktopSmokeDisabled: "Desktop Smoke not enabled",
    desktopBridgeMissing: "Desktop Bridge unavailable",
    unknownWorkspace: "Unknown workspace",
    noAllowlist: "No allowlist reported",
    pairWorkerEmpty: "Connect local Codex to begin local execution.",
    auditTrail: "Audit trail",
    auditTrailSubtitle: "Lifecycle events from users and local Codex.",
    auditEmpty: "Audit events will appear after users and local Codex act.",
    executionGuardrails: "Execution guardrails",
    currentSafetyControls: "Current MVP safety controls.",
    guardrailAllowlist: "Shell and Codex tasks run only inside the local Codex connector allowlist.",
    guardrailApproval: "Destructive shell patterns pause for approval before execution.",
    guardrailAudit: "Local Codex connector lifecycle, task claims, approvals, completion, and failures are audited.",
    guardrailBrowser: "Browser and computer tasks require the desktop Codex native Browser plugin or Computer Use channel; tasks fail clearly when that channel is unavailable.",
    guardrailWorkspace: "Local Codex connectors belong to a workspace and can restrict allowed task modes.",
    guardrailRoles: "Workspace roles are owner, admin, operator, and viewer.",
    workerLaunch: "Local Codex launch",
    workerLaunchSubtitle: "Use an allowlist when connecting production machines.",
    desktopLaunchChecklist: "Desktop launch checklist",
    desktopLaunchChecklistSubtitle: "Confirm whether this local worker can accept Browser and Computer tasks.",
    checklistConnectedWorker: "Local worker connected",
    checklistDesktopBackend: "Desktop backend enabled",
    checklistTaskModes: "Browser/Computer modes allowed",
    checklistDesktopBridge: "Desktop Bridge available",
    checklistDesktopSmoke: "Desktop Smoke verified",
    checklistCuaDriver: "CuaDriver permissions ready",
    checklistChrome: "Chrome channel ready",
    checklistReady: "Ready",
    checklistNeedsAttention: "Needs attention",
    checklistOptional: "Optional",
    checklistNoWorker: "No worker yet. Create a pairing token and start the local worker.",
    checklistUseRecommendedCommand: "Use the recommended launch command and keep Codex Desktop signed in.",
    checklistAllowModes: "The launch command needs --allowed-mode browser and --allowed-mode computer.",
    checklistSmokeHint: "Enable CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true and CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=true.",
    registeredWorkers: "registered workers",
    adminUsers: "Customer accounts",
    adminUsersSubtitle: "Customers cannot self-register; platform admins provision accounts here.",
    createCustomer: "Create customer",
    customerEmail: "Customer email",
    initialPassword: "Initial password",
    customerWorkspace: "Customer workspace",
    createUser: "Create user",
    creating: "Creating",
    userCreated: "Customer account created",
    usersEmpty: "No customer accounts yet.",
    disabled: "Disabled",
    active: "Active",
    disableUser: "Disable",
    enableUser: "Enable",
    resetPassword: "Reset password",
    newPassword: "New password",
    adminRole: "Admin",
    customerRole: "Customer",
    status: {
      pending: "pending",
      running: "running",
      waiting_user: "waiting user",
      canceling: "canceling",
      canceled: "canceled",
      completed: "completed",
      failed: "failed"
    }
  }
} as const;

type Copy = (typeof COPY)[Language];

interface AppState {
  token: string;
  user: UserProfile;
}

type ConsoleView = "tasks" | "files" | "workers" | "admin" | "audit" | "settings";

type PromptTemplateId = "customer-research" | "low-risk-engagement" | "content-publish";

interface BuiltinPromptTemplate {
  id: PromptTemplateId;
  mode: TaskMode;
  icon: "globe" | "shield" | "file";
  titleKey: "customerResearchTemplate" | "lowRiskEngagementTemplate" | "contentPublishTemplate";
  descKey: "customerResearchTemplateDesc" | "lowRiskEngagementTemplateDesc" | "contentPublishTemplateDesc";
  prompt: Record<Language, string>;
}

interface PromptTemplateInput {
  title: string;
  description: string;
  prompt: string;
  mode: TaskMode;
}

const PROMPT_TEMPLATES: BuiltinPromptTemplate[] = [
  {
    id: "customer-research",
    mode: "browser",
    icon: "globe",
    titleKey: "customerResearchTemplate",
    descKey: "customerResearchTemplateDesc",
    prompt: {
      zh: `任务：客户信息采集

客户/行业：［填写客户名称、行业、城市或目标人群］
平台：小红书、抖音、官网、公开搜索结果
目标：收集公开可见信息，形成可用于销售跟进的线索简报。

执行要求：
1. 只采集公开页面中可见的信息，不登录陌生账号，不绕过验证码、权限或风控。
2. 用关键词搜索相关账号、笔记/视频、评论区常见需求和竞品表达。
3. 记录来源链接、账号名、内容主题、潜在需求、可跟进理由。
4. 不自动评论、不私信、不发布内容。
5. 输出一张线索表，并给出下一步人工跟进建议。`,
      en: `Task: customer research

Customer / industry: [fill customer name, industry, city, or target audience]
Platforms: Xiaohongshu, Douyin, official site, public search results
Goal: collect public information and turn it into a lead brief for sales follow-up.

Requirements:
1. Only collect publicly visible information. Do not log into unfamiliar accounts or bypass CAPTCHAs, permissions, or platform controls.
2. Search keywords for relevant accounts, posts/videos, common needs in comments, and competitor language.
3. Record source URL, account name, topic, potential need, and follow-up reason.
4. Do not automatically comment, DM, or publish.
5. Output a lead table and recommended human follow-up actions.`
    }
  },
  {
    id: "low-risk-engagement",
    mode: "browser",
    icon: "shield",
    titleKey: "lowRiskEngagementTemplate",
    descKey: "lowRiskEngagementTemplateDesc",
    prompt: {
      zh: `任务：低风险互动获客助手

业务信息：［填写产品/服务、优势、禁用话术、目标客户］
关键词：［填写 3-10 个关键词］
平台：［小红书/抖音/其他］

低风险边界：
1. 先做关键词搜索和线索筛选，只读取公开内容。
2. 不批量刷评论、不复制粘贴同一句话、不私信骚扰、不规避平台限制。
3. 只生成个性化互动建议和评论草稿，不直接发布。
4. 每条建议必须说明：为什么适合互动、风险点、建议回复、是否需要人工确认。
5. 遇到登录、验证码、支付、关注、评论、私信、发布等动作时停下来，等待人工确认。

输出格式：
- 高意向线索列表
- 每条线索的互动建议
- 可直接审核的评论/私信草稿
- 今日安全操作上限建议`,
      en: `Task: low-risk engagement assistant

Business info: [fill product/service, strengths, banned claims, target customer]
Keywords: [fill 3-10 keywords]
Platform: [Xiaohongshu / Douyin / other]

Safety boundaries:
1. Start with keyword search and lead filtering; read public content only.
2. Do not mass-comment, copy-paste the same message, spam DMs, or bypass platform limits.
3. Generate personalized engagement advice and draft comments only. Do not publish.
4. For every suggestion, explain why it fits, the risk, the suggested reply, and whether human confirmation is needed.
5. Stop and wait for human confirmation before login, CAPTCHA, payment, follow, comment, DM, or publish actions.

Output:
- High-intent lead list
- Engagement recommendation per lead
- Review-ready comment/DM drafts
- Suggested safe daily action cap`
    }
  },
  {
    id: "content-publish",
    mode: "computer",
    icon: "file",
    titleKey: "contentPublishTemplate",
    descKey: "contentPublishTemplateDesc",
    prompt: {
      zh: `任务：内容发布助手

发布平台：［小红书/抖音/其他］
内容主题：［填写主题］
素材位置：［填写工作区文件名或本地路径］
品牌要求：［填写语气、禁用词、合规边界］

执行要求：
1. 先检查素材是否齐全，列出缺失项。
2. 生成标题、正文、标签、封面建议和发布前检查清单。
3. 可以打开平台后台或发布页做草稿整理，但不要自动点击最终发布。
4. 涉及登录、验证码、账号切换、支付、最终发布时必须停下来等待人工确认。
5. 完成后返回草稿内容、检查清单、待人工确认事项和截图/链接说明。`,
      en: `Task: content publishing assistant

Platform: [Xiaohongshu / Douyin / other]
Topic: [fill topic]
Assets: [workspace file name or local path]
Brand requirements: [tone, banned words, compliance boundaries]

Requirements:
1. Check whether assets are complete and list missing items.
2. Generate title, body copy, tags, cover suggestion, and pre-publish checklist.
3. You may open the platform backend or publish page to prepare a draft, but do not click final publish.
4. Stop and wait for human confirmation for login, CAPTCHA, account switching, payment, or final publishing.
5. Return draft content, checklist, required human confirmations, and screenshot/link notes.`
    }
  }
];

declare global {
  interface Window {
    codexbroRoot?: Root;
  }
}

function App() {
  const [session, setSession] = useState<AppState | null>(() => {
    const raw = localStorage.getItem("codexbro.session");
    return raw ? (JSON.parse(raw) as AppState) : null;
  });
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem("codexbro.language");
    return stored === "en" ? "en" : "zh";
  });
  const t = COPY[language];

  function setLanguage(nextLanguage: Language) {
    localStorage.setItem("codexbro.language", nextLanguage);
    setLanguageState(nextLanguage);
  }

  if (!session) {
    return <LoginScreen language={language} t={t} onLanguageChange={setLanguage} onLogin={setSession} />;
  }

  return <Console language={language} t={t} onLanguageChange={setLanguage} session={session} onLogout={() => {
    localStorage.removeItem("codexbro.session");
    setSession(null);
  }} />;
}

function LoginScreen({
  language,
  t,
  onLanguageChange,
  onLogin
}: {
  language: Language;
  t: Copy;
  onLanguageChange: (language: Language) => void;
  onLogin: (session: AppState) => void;
}) {
  const [email, setEmail] = useState("founder@codexbro.local");
  const [password, setPassword] = useState("codexbro-demo");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await request<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: { email, password }
      });
      const nextSession = { token: response.token, user: response.user };
      localStorage.setItem("codexbro.session", JSON.stringify(nextSession));
      onLogin(nextSession);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t.loginFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-lockup">
          <span className="brand-mark"><Workflow size={22} /></span>
          <strong>CodexBro</strong>
        </div>
        <div>
          <h1>{t.loginHeadline}</h1>
          <p>{t.loginSubtitle}</p>
        </div>
        <form onSubmit={submit} className="login-form">
          <label>
            {t.email}
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label>
            {t.password}
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button" disabled={loading} type="submit">
            <KeyRound size={16} />
            {loading ? t.signingIn : t.signIn}
          </button>
        </form>
        <LanguageSwitch language={language} onLanguageChange={onLanguageChange} />
      </section>
      <section className="login-preview">
        <div className="preview-top">
          <span>{t.liveWorker}</span>
          <strong>{t.online}</strong>
        </div>
        <pre>{`$ codexbro task run
${t.previewWorker}
${t.previewMode}
${t.previewStatus}

✓ ${t.previewBound}
✓ ${t.previewClaimed}
✓ ${t.previewUploaded}`}</pre>
      </section>
    </main>
  );
}

function Console({
  language,
  t,
  onLanguageChange,
  session,
  onLogout
}: {
  language: Language;
  t: Copy;
  onLanguageChange: (language: Language) => void;
  session: AppState;
  onLogout: () => void;
}) {
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [workspaces, setWorkspaces] = useState<Array<WorkspaceRecord & { role: WorkspaceRole }>>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileRecord[]>([]);
  const [workspacePromptTemplates, setWorkspacePromptTemplates] = useState<WorkspacePromptTemplateRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<TaskLogRecord[]>([]);
  const [audits, setAudits] = useState<AuditEventRecord[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [pairing, setPairing] = useState<PairingTokenResponse | null>(null);
  const [activeView, setActiveView] = useState<ConsoleView>("tasks");
  const isPlatformAdmin = session.user.platformRole === "admin";

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );

  async function refresh() {
    const [workspaceResponse, workerResponse, taskResponse, auditResponse, fileResponse, templateResponse, adminResponse] = await Promise.all([
      authed<{ workspaces: Array<WorkspaceRecord & { role: WorkspaceRole }> }>(session.token, "/api/workspaces"),
      authed<{ workers: WorkerRecord[] }>(session.token, "/api/workers"),
      authed<{ tasks: TaskRecord[] }>(session.token, "/api/tasks"),
      authed<{ audits: AuditEventRecord[] }>(session.token, "/api/audit"),
      authed<{ files: WorkspaceFileRecord[] }>(session.token, "/api/workspace-files"),
      authed<{ templates: WorkspacePromptTemplateRecord[] }>(session.token, "/api/prompt-templates"),
      isPlatformAdmin ? authed<AdminUsersResponse>(session.token, "/api/admin/users") : Promise.resolve<AdminUsersResponse>({ users: [], workspaces: [] })
    ]);
    setWorkspaces(workspaceResponse.workspaces);
    setWorkspaceFiles(fileResponse.files);
    setWorkspacePromptTemplates(templateResponse.templates);
    setWorkers(workerResponse.workers);
    setTasks(taskResponse.tasks);
    setAudits(auditResponse.audits);
    setAdminUsers(adminResponse.users);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedTask) {
      setLogs([]);
      return;
    }

    setLogs([]);
    let canceled = false;
    void authed<{ logs: TaskLogRecord[] }>(session.token, `/api/tasks/${selectedTask.id}/logs`)
      .then((response) => {
        if (!canceled) setLogs(response.logs);
      })
      .catch(() => {
        if (!canceled) setLogs([]);
      });
    const source = new EventSource(`/api/tasks/${selectedTask.id}/stream?token=${session.token}`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as TaskStreamEvent;
      if (payload.type === "log" && payload.log) {
        setLogs((current) => mergeLogs(current, payload.log!));
      }
      if (payload.type === "task" && payload.task) {
        setTasks((current) => current.map((task) => task.id === payload.task!.id ? payload.task! : task));
      }
    };

    return () => {
      canceled = true;
      source.close();
    };
  }, [selectedTask?.id, session.token]);

  async function createPairingToken() {
    const response = await authed<PairingTokenResponse>(session.token, "/api/workers/pairing-token", {
      method: "POST"
    });
    setPairing(response);
  }

  async function approve(taskId: string) {
    const response = await authed<{ task: TaskRecord }>(session.token, `/api/tasks/${taskId}/approve`, {
      method: "POST"
    });
    setTasks((current) => current.map((task) => task.id === taskId ? response.task : task));
  }

  async function cancel(taskId: string) {
    const response = await authed<{ task: TaskRecord }>(session.token, `/api/tasks/${taskId}/cancel`, {
      method: "POST"
    });
    setTasks((current) => current.map((task) => task.id === taskId ? response.task : task));
  }

  async function retry(taskId: string) {
    const response = await authed<{ task: TaskRecord }>(session.token, `/api/tasks/${taskId}/retry`, {
      method: "POST"
    });
    setTasks((current) => [response.task, ...current]);
    setSelectedTaskId(response.task.id);
  }

  async function createTask(input: {
    workerId: string;
    mode: TaskMode;
    prompt: string;
    workingDirectory: string;
    attachedFileIds?: string[];
  }) {
    const response = await authed<{ task: TaskRecord }>(session.token, "/api/tasks", {
      method: "POST",
      body: {
        ...input,
        idempotencyKey: `${input.workerId}:${input.mode}:${input.workingDirectory}:${input.attachedFileIds?.join(",") ?? ""}:${input.prompt}`
      }
    });
    setTasks((current) => [response.task, ...current]);
    setSelectedTaskId(response.task.id);
    return response.task;
  }

  async function uploadWorkspaceFile(file: File) {
    const workspaceId = workspaces[0]?.id;
    if (!workspaceId) return;
    const response = await fetch(`${API}/api/workspaces/${workspaceId}/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name)
      },
      body: file
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(payload.error ?? response.statusText);
    }
    const payload = (await response.json()) as { file: WorkspaceFileRecord };
    setWorkspaceFiles((current) => [payload.file, ...current.filter((item) => item.id !== payload.file.id)]);
  }

  async function deleteWorkspaceFile(fileId: string) {
    await authed<{ ok: true }>(session.token, `/api/workspace-files/${fileId}`, { method: "DELETE" });
    setWorkspaceFiles((current) => current.filter((file) => file.id !== fileId));
  }

  async function createPromptTemplate(input: PromptTemplateInput) {
    let workspaceId = workspaces[0]?.id;
    if (!workspaceId) {
      const response = await authed<{ workspaces: Array<WorkspaceRecord & { role: WorkspaceRole }> }>(session.token, "/api/workspaces");
      setWorkspaces(response.workspaces);
      workspaceId = response.workspaces[0]?.id;
    }
    if (!workspaceId) return;
    const response = await authed<{ template: WorkspacePromptTemplateRecord }>(session.token, `/api/workspaces/${workspaceId}/prompt-templates`, {
      method: "POST",
      body: input
    });
    setWorkspacePromptTemplates((current) => [response.template, ...current.filter((template) => template.id !== response.template.id)]);
  }

  async function updatePromptTemplate(templateId: string, input: PromptTemplateInput) {
    const response = await authed<{ template: WorkspacePromptTemplateRecord }>(session.token, `/api/prompt-templates/${templateId}`, {
      method: "PATCH",
      body: input
    });
    setWorkspacePromptTemplates((current) => current.map((template) => template.id === response.template.id ? response.template : template));
  }

  async function deletePromptTemplate(templateId: string) {
    await authed<{ ok: true }>(session.token, `/api/prompt-templates/${templateId}`, { method: "DELETE" });
    setWorkspacePromptTemplates((current) => current.filter((template) => template.id !== templateId));
  }

  async function unbindWorker(workerId: string) {
    await authed<{ ok: true }>(session.token, `/api/workers/${workerId}`, { method: "DELETE" });
    setWorkers((current) => current.filter((worker) => worker.id !== workerId));
    setTasks((current) => current.map((task) => task.workerId === workerId && !["completed", "failed", "canceled"].includes(task.status)
      ? { ...task, status: "failed", error: "Worker was unbound before the task completed." }
      : task));
  }

  async function createAdminUser(input: {
    email: string;
    password: string;
    workspaceName: string;
  }) {
    await authed<{ user: AdminUserSummary }>(session.token, "/api/admin/users", {
      method: "POST",
      body: {
        ...input,
        platformRole: "user",
        workspaceRole: "owner"
      }
    });
    await refresh();
  }

  async function updateAdminUser(userId: string, input: { disabled?: boolean; password?: string }) {
    await authed<{ user: AdminUserSummary }>(session.token, `/api/admin/users/${userId}`, {
      method: "PATCH",
      body: input
    });
    await refresh();
  }

  return (
    <main className="app-shell">
      <Sidebar language={language} t={t} activeView={activeView} isPlatformAdmin={isPlatformAdmin} onLanguageChange={onLanguageChange} onViewChange={setActiveView} />
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{viewTitle(activeView, t)}</h1>
            <p>{viewSubtitle(activeView, t)}</p>
          </div>
          <button className="user-button" onClick={onLogout}>
            <UserCircle2 size={18} />
            {session.user.email}
          </button>
        </header>

        {activeView === "tasks" ? (
          <TaskChatWorkspace
            language={language}
            t={t}
            token={session.token}
            workers={workers}
            workspaces={workspaces}
            workspaceFiles={workspaceFiles}
            promptTemplates={workspacePromptTemplates}
            tasks={tasks}
            selectedTask={selectedTask}
            logs={logs}
            pairing={pairing}
            onPair={createPairingToken}
            onSelect={setSelectedTaskId}
            onCreate={createTask}
            onUploadFile={uploadWorkspaceFile}
            onDeleteFile={deleteWorkspaceFile}
            onCreatePromptTemplate={createPromptTemplate}
            onUpdatePromptTemplate={updatePromptTemplate}
            onDeletePromptTemplate={deletePromptTemplate}
            onOpenFiles={() => setActiveView("files")}
            onApprove={approve}
            onCancel={cancel}
            onRetry={retry}
          />
        ) : null}

        {activeView === "files" ? (
          <WorkspaceFilesView
            t={t}
            token={session.token}
            files={workspaceFiles}
            onUploadFile={uploadWorkspaceFile}
            onDeleteFile={deleteWorkspaceFile}
          />
        ) : null}
        {activeView === "workers" ? <WorkersView t={t} workers={workers} workspaces={workspaces} pairing={pairing} onPair={createPairingToken} onUnbind={unbindWorker} /> : null}
        {activeView === "admin" && isPlatformAdmin ? (
          <AdminView
            t={t}
            users={adminUsers}
            currentUserId={session.user.id}
            onCreateUser={createAdminUser}
            onUpdateUser={updateAdminUser}
          />
        ) : null}
        {activeView === "audit" ? <AuditView t={t} audits={audits} /> : null}
        {activeView === "settings" ? <SettingsView t={t} workers={workers} /> : null}
      </section>
    </main>
  );
}

function Sidebar({
  language,
  t,
  activeView,
  isPlatformAdmin,
  onLanguageChange,
  onViewChange
}: {
  language: Language;
  t: Copy;
  activeView: ConsoleView;
  isPlatformAdmin: boolean;
  onLanguageChange: (language: Language) => void;
  onViewChange: (view: ConsoleView) => void;
}) {
  const items: Array<{ view: ConsoleView; label: string; icon: React.ReactNode }> = [
    { view: "tasks", label: t.tasks, icon: <ListChecks size={18} /> },
    { view: "files", label: t.files, icon: <FolderLock size={18} /> },
    { view: "workers", label: t.workers, icon: <Computer size={18} /> },
    ...(isPlatformAdmin ? [{ view: "admin" as const, label: t.admin, icon: <ShieldCheck size={18} /> }] : []),
    { view: "audit", label: t.audit, icon: <Archive size={18} /> },
    { view: "settings", label: t.settings, icon: <Settings size={18} /> }
  ];

  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <span className="brand-mark"><Workflow size={20} /></span>
        <strong>CodexBro</strong>
      </div>
      <nav>
        {items.map((item) => (
          <button key={item.view} className={activeView === item.view ? "active" : ""} onClick={() => onViewChange(item.view)}>
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <LanguageSwitch language={language} onLanguageChange={onLanguageChange} />
      <div className="security-note">
        <Lock size={16} />
        {t.sidebarNote}
      </div>
    </aside>
  );
}

function LanguageSwitch({
  language,
  onLanguageChange
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  return (
    <div className="language-switch" aria-label="Language switch">
      <button type="button" className={language === "zh" ? "active" : ""} onClick={() => onLanguageChange("zh")}>中文</button>
      <button type="button" className={language === "en" ? "active" : ""} onClick={() => onLanguageChange("en")}>EN</button>
    </div>
  );
}

function viewTitle(view: ConsoleView, t: Copy) {
  if (view === "files") return t.files;
  if (view === "workers") return t.workers;
  if (view === "admin") return t.admin;
  if (view === "audit") return t.audit;
  if (view === "settings") return t.settings;
  return t.tasks;
}

function viewSubtitle(view: ConsoleView, t: Copy) {
  if (view === "files") return t.filesSubtitle;
  if (view === "workers") return t.workersSubtitle;
  if (view === "admin") return t.adminSubtitle;
  if (view === "audit") return t.auditSubtitle;
  if (view === "settings") return t.settingsSubtitle;
  return t.tasksSubtitle;
}

function TaskChatWorkspace({
  language,
  t,
  token,
  workers,
  workspaces,
  workspaceFiles,
  promptTemplates,
  tasks,
  selectedTask,
  logs,
  pairing,
  onPair,
  onSelect,
  onCreate,
  onUploadFile,
  onDeleteFile,
  onCreatePromptTemplate,
  onUpdatePromptTemplate,
  onDeletePromptTemplate,
  onOpenFiles,
  onApprove,
  onCancel,
  onRetry
}: {
  language: Language;
  t: Copy;
  token: string;
  workers: WorkerRecord[];
  workspaces: Array<WorkspaceRecord & { role: WorkspaceRole }>;
  workspaceFiles: WorkspaceFileRecord[];
  promptTemplates: WorkspacePromptTemplateRecord[];
  tasks: TaskRecord[];
  selectedTask: TaskRecord | null;
  logs: TaskLogRecord[];
  pairing: PairingTokenResponse | null;
  onPair: () => void;
  onSelect: (taskId: string | null) => void;
  onCreate: (input: {
    workerId: string;
    mode: TaskMode;
    prompt: string;
    workingDirectory: string;
    attachedFileIds?: string[];
  }) => Promise<TaskRecord>;
  onUploadFile: (file: File) => Promise<void>;
  onDeleteFile: (fileId: string) => Promise<void>;
  onCreatePromptTemplate: (input: PromptTemplateInput) => Promise<void>;
  onUpdatePromptTemplate: (templateId: string, input: PromptTemplateInput) => Promise<void>;
  onDeletePromptTemplate: (templateId: string) => Promise<void>;
  onOpenFiles: () => void;
  onApprove: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
}) {
  const [workerId, setWorkerId] = useState("");
  const [mode, setMode] = useState<TaskMode>("shell");
  const [prompt, setPrompt] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templatePrompt, setTemplatePrompt] = useState("");
  const [templateMode, setTemplateMode] = useState<TaskMode>("browser");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const online = workers.filter((worker) => worker.status === "online").length;

  useEffect(() => {
    if (!workerId && workers[0]) setWorkerId(workers[0].id);
  }, [workers, workerId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!workerId || !prompt.trim()) return;
    setLoading(true);
    try {
      await onCreate({
        workerId,
        mode,
        prompt: prompt.trim(),
        workingDirectory,
        attachedFileIds: selectedFileIds
      });
      setPrompt("");
      setSelectedFileIds([]);
    } finally {
      setLoading(false);
    }
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        await onUploadFile(file);
      }
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function toggleFile(fileId: string) {
    setSelectedFileIds((current) => current.includes(fileId)
      ? current.filter((id) => id !== fileId)
      : [...current, fileId]);
  }

  function applyBuiltinPromptTemplate(template: BuiltinPromptTemplate) {
    setPrompt(template.prompt[language]);
    setMode(template.mode);
  }

  function applyCustomPromptTemplate(template: WorkspacePromptTemplateRecord) {
    setPrompt(template.prompt);
    setMode(template.mode);
  }

  function resetTemplateForm() {
    setTemplateTitle("");
    setTemplateDescription("");
    setTemplatePrompt("");
    setTemplateMode("browser");
    setEditingTemplateId(null);
  }

  function startTemplateCreate() {
    resetTemplateForm();
    setTemplateFormOpen(true);
  }

  function startTemplateEdit(template: WorkspacePromptTemplateRecord) {
    setTemplateTitle(template.title);
    setTemplateDescription(template.description);
    setTemplatePrompt(template.prompt);
    setTemplateMode(template.mode);
    setEditingTemplateId(template.id);
    setTemplateFormOpen(true);
  }

  async function savePromptTemplate() {
    if (!templateTitle.trim() || !templatePrompt.trim()) return;
    setSavingTemplate(true);
    try {
      const input = {
        title: templateTitle.trim(),
        description: templateDescription.trim(),
        prompt: templatePrompt.trim(),
        mode: templateMode
      };
      if (editingTemplateId) {
        await onUpdatePromptTemplate(editingTemplateId, input);
      } else {
        await onCreatePromptTemplate(input);
      }
      resetTemplateForm();
      setTemplateFormOpen(false);
    } finally {
      setSavingTemplate(false);
    }
  }

  return (
    <section className="chat-workspace compact-chat">
      <aside className="chat-history panel slim-history">
        <button className={`history-new-task ${!selectedTask ? "active" : ""}`} type="button" onClick={() => onSelect(null)}>
          <Workflow size={16} />
          {t.newTask}
        </button>
        <div className="history-heading">
          <h2>{t.chatHistory}</h2>
          <small>{tasks.length}</small>
        </div>
        <div className="chat-task-list">
          {tasks.map((task) => (
            <button key={task.id} className={`chat-task-item ${selectedTask?.id === task.id ? "selected" : ""}`} type="button" onClick={() => onSelect(task.id)}>
              <StatusIcon status={task.status} />
              <span>
                <strong>{task.title}</strong>
                <small>{modeLabel(task.mode, t)} · {t.status[task.status]}</small>
              </span>
            </button>
          ))}
          {!tasks.length ? <div className="empty-text history-empty">{t.conversationEmpty}</div> : null}
        </div>
      </aside>

      <div className="chat-main panel">
        <div className="chat-header">
          <div>
            <h2>{t.taskConversation}</h2>
            <p>{t.taskConversationSubtitle}</p>
          </div>
          <div className="chat-header-tools">
            <span className="chat-worker-dot" title={t.localWorkerOnline}>{online} / {workers.length}</span>
          </div>
        </div>

        <div className="chat-body">
          {!selectedTask ? (
            <div className="chat-empty">
              <Workflow size={28} />
              <p>{t.conversationEmpty}</p>
            </div>
          ) : (
            <>
              <ChatBubble role="user" title={t.taskRequest} meta={`${modeLabel(selectedTask.mode, t)} · ${t.attempt} ${selectedTask.attempt}${t.attemptSuffix}`}>
                <p>{selectedTask.prompt}</p>
                {selectedTask.workingDirectory ? <small>{t.directory}: {selectedTask.workingDirectory}</small> : null}
                {selectedTask.attachedFileIds.length ? <small>{t.attachedFiles}: {selectedTask.attachedFileIds.length}</small> : null}
              </ChatBubble>

              <ExecutionOverview t={t} task={selectedTask} logs={logs} />

              <ChatBubble role="system" title={t.workerFeedback} meta={t.rawLogs}>
                {logs.length ? (
                  <div className="chat-log-stream">
                    {logs.map((log) => (
                      <div key={log.id} className={`chat-log-line ${log.level}`}>
                        <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
                        <LogLevelIcon level={log.level} />
                        <code>{log.message}</code>
                      </div>
                    ))}
                  </div>
                ) : <p>{t.noLogsYet}</p>}
              </ChatBubble>

              {selectedTask.status === "waiting_user" ? (
                <ApprovalCard t={t} task={selectedTask} onApprove={() => onApprove(selectedTask.id)} />
              ) : null}

              {selectedTask.result ? (
                <ChatBubble role="assistant" title={t.taskResult}>
                  <pre className="chat-result">{selectedTask.result}</pre>
                </ChatBubble>
              ) : null}

              {selectedTask.artifacts.length ? (
                <ChatBubble role="assistant" title={t.taskArtifacts}>
                  <div className="artifact-list">
                    {selectedTask.artifacts.map((artifact) => (
                      <ArtifactItem key={artifact.id} artifact={artifact} token={token} />
                    ))}
                  </div>
                </ChatBubble>
              ) : null}
            </>
          )}
        </div>

        <form className="chat-composer" onSubmit={submit}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t.promptPlaceholder} rows={4} />
          <div className="composer-drawer-row">
            <details className="composer-drawer prompt-template-drawer">
              <summary><ShieldCheck size={15} />{t.promptTemplates}</summary>
              <div className="prompt-template-box">
                <div className="prompt-template-header">
                  <small>{t.promptTemplatesSubtitle}</small>
                </div>
                <div className="prompt-template-section-title">
                  <strong>{t.builtinTemplates}</strong>
                </div>
                <div className="prompt-template-grid">
                  {PROMPT_TEMPLATES.map((template) => (
                    <button key={template.id} className="prompt-template-card" type="button" onClick={() => applyBuiltinPromptTemplate(template)}>
                      <PromptTemplateIcon icon={template.icon} />
                      <span>
                        <strong>{t[template.titleKey]}</strong>
                        <small>{t[template.descKey]}</small>
                      </span>
                      <em>{t.useTemplate}</em>
                    </button>
                  ))}
                </div>
                <div className="prompt-template-section-title with-action">
                  <strong>{t.customTemplates}</strong>
                  <button className="secondary-button compact-button" type="button" onClick={startTemplateCreate}>
                    <Plus size={14} />
                    {t.newPromptTemplate}
                  </button>
                </div>
                {templateFormOpen ? (
                  <div className="prompt-template-form">
                    <div className="form-row">
                      <label>
                        {t.templateTitle}
                        <input value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} />
                      </label>
                      <label>
                        {t.templateMode}
                        <select value={templateMode} onChange={(event) => setTemplateMode(event.target.value as TaskMode)}>
                          <option value="shell">{t.shell}</option>
                          <option value="codex">{t.codex}</option>
                          <option value="browser">{t.browser}</option>
                          <option value="computer">{t.computer}</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      {t.templateDescription}
                      <input value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} />
                    </label>
                    <label>
                      {t.templatePrompt}
                      <textarea value={templatePrompt} onChange={(event) => setTemplatePrompt(event.target.value)} rows={4} />
                    </label>
                    <div className="prompt-template-form-actions">
                      <button className="secondary-button" type="button" onClick={() => {
                        resetTemplateForm();
                        setTemplateFormOpen(false);
                      }}>
                        {t.cancelTemplateEdit}
                      </button>
                      <button className="primary-button" disabled={!templateTitle.trim() || !templatePrompt.trim() || savingTemplate} type="button" onClick={() => void savePromptTemplate()}>
                        <Save size={15} />
                        {editingTemplateId ? t.updateTemplate : t.saveTemplate}
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="prompt-template-custom-list">
                  {promptTemplates.map((template) => (
                    <article key={template.id} className="prompt-template-card custom-template-card">
                      <button className="prompt-template-apply" type="button" onClick={() => applyCustomPromptTemplate(template)}>
                        <FileText size={17} />
                        <span>
                          <strong>{template.title}</strong>
                          <small>{template.description || modeLabel(template.mode, t)}</small>
                        </span>
                        <em>{t.useTemplate}</em>
                      </button>
                      <div className="prompt-template-actions">
                        <button className="icon-button" type="button" title={t.editPromptTemplate} onClick={() => startTemplateEdit(template)}>
                          <Edit3 size={14} />
                        </button>
                        <button className="icon-button" type="button" title={t.deleteFile} onClick={() => void onDeletePromptTemplate(template.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                  {!promptTemplates.length ? <div className="empty-state compact">{t.customTemplateEmpty}</div> : null}
                </div>
              </div>
            </details>
            <button className="composer-file-entry" type="button" onClick={onOpenFiles}>
              <FolderLock size={15} />
              <span>
                <strong>{t.workspaceFiles}</strong>
                <small>{workspaceFiles.length}</small>
              </span>
            </button>
            <details className="composer-drawer">
              <summary><FileText size={15} />{t.attachFiles}{selectedFileIds.length ? ` · ${selectedFileIds.length}` : ""}</summary>
              <div className="workspace-file-box">
                <div className="workspace-file-header">
                  <small>{t.workspaceFilesSubtitle}</small>
                  <label className="secondary-button file-upload-button">
                    <Upload size={16} />
                    {uploading ? t.starting : t.uploadFile}
                    <input multiple type="file" onChange={upload} />
                  </label>
                </div>
                <div className="workspace-file-list">
                  {workspaceFiles.map((file) => (
                    <label key={file.id} className="workspace-file-row">
                      <input checked={selectedFileIds.includes(file.id)} onChange={() => toggleFile(file.id)} type="checkbox" />
                      <FileText size={15} />
                      <span>
                        <strong>{file.name}</strong>
                        <small>{formatBytes(file.size)} · {new Date(file.createdAt).toLocaleString()}</small>
                      </span>
                      <button className="icon-button" type="button" title="Delete" onClick={(event) => {
                        event.preventDefault();
                        void onDeleteFile(file.id);
                      }}>
                        <Trash2 size={14} />
                      </button>
                    </label>
                  ))}
                  {!workspaceFiles.length ? <div className="empty-state compact">{t.noWorkspaceFiles}</div> : null}
                </div>
              </div>
            </details>

            <details className="composer-drawer">
              <summary><Settings size={15} />{t.modeAndWorker}</summary>
              <div className="chat-controls">
                <label>
                  {t.targetWorker}
                  <select value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
                    <option value="">{t.selectWorker}</option>
                    {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
                  </select>
                </label>
                <label>
                  {t.runMode}
                  <select value={mode} onChange={(event) => setMode(event.target.value as TaskMode)}>
                    <option value="shell">{t.shell}</option>
                    <option value="codex">{t.codex}</option>
                    <option value="browser">{t.browser}</option>
                    <option value="computer">{t.computer}</option>
                  </select>
                </label>
                <label>
                  {t.workingDirectory}
                  <input value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} placeholder={t.workingDirectoryPlaceholder} />
                </label>
              </div>
              <SelectedWorkerHealth t={t} worker={workers.find((worker) => worker.id === workerId)} mode={mode} />
            </details>
          </div>
          <div className="chat-actions">
            <button className="secondary-button" type="button" onClick={onPair}><KeyRound size={16} />{t.pairWorker}</button>
            {selectedTask && ["pending", "running", "waiting_user", "canceling"].includes(selectedTask.status) ? (
              <button className="secondary-button danger" disabled={selectedTask.status === "canceling"} type="button" onClick={() => onCancel(selectedTask.id)}>
                <XCircle size={16} />{selectedTask.status === "canceling" ? t.canceling : t.cancelTask}
              </button>
            ) : null}
            {selectedTask && ["completed", "failed", "canceled"].includes(selectedTask.status) ? (
              <button className="secondary-button" type="button" onClick={() => onRetry(selectedTask.id)}><Play size={16} />{t.retryTask}</button>
            ) : null}
            <button className="primary-button" disabled={!workers.length || !prompt.trim() || loading} type="submit">
              <Play size={16} />{loading ? t.starting : t.sendTask}
            </button>
          </div>
          <PairingCommand t={t} pairing={pairing} standalone />
        </form>
      </div>
    </section>
  );
}

function PromptTemplateIcon({ icon }: { icon: BuiltinPromptTemplate["icon"] }) {
  if (icon === "shield") return <ShieldCheck size={17} />;
  if (icon === "file") return <FileText size={17} />;
  return <Globe size={17} />;
}

function ChatBubble({
  role,
  title,
  meta,
  children
}: {
  role: "user" | "assistant" | "system";
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <article className={`chat-bubble ${role}`}>
      <div className="chat-bubble-title">
        <strong>{title}</strong>
        {meta ? <span>{meta}</span> : null}
      </div>
      <div className="chat-bubble-content">{children}</div>
    </article>
  );
}

function ApprovalCard({ t, task, onApprove }: { t: Copy; task: TaskRecord; onApprove: () => void }) {
  const approval = task.approvalRequest;
  const hint = task.mode === "browser" || task.mode === "computer" ? t.approvalBrowserComputerHint : t.approvalShellHint;
  return (
    <article className="approval-card">
      <div className="approval-card-head">
        <ShieldAlert size={18} />
        <div>
          <strong>{t.approvalTitle}</strong>
          <p>{t.approvalSubtitle}</p>
        </div>
      </div>
      <div className="approval-hint">{hint}</div>
      {task.approvalReason ? <p className="approval-reason">{task.approvalReason}</p> : null}
      <dl className="approval-details prominent">
        <div><dt>{t.runMode}</dt><dd>{modeLabel(task.mode, t)}</dd></div>
        <div><dt>{t.risk}</dt><dd>{approval?.riskClass ?? "manual"}</dd></div>
        <div><dt>{t.action}</dt><dd>{approval?.action ?? "manual_approval"}</dd></div>
        {approval?.workingDirectory ? <div><dt>{t.directory}</dt><dd>{approval.workingDirectory}</dd></div> : null}
        {approval?.command ? <div><dt>{t.command}</dt><dd>{approval.command}</dd></div> : null}
      </dl>
      <div className="approval-actions">
        <button className="primary-button amber" type="button" onClick={onApprove}>
          <ShieldCheck size={16} />
          {t.approveOperation}
        </button>
      </div>
    </article>
  );
}

function ExecutionOverview({ t, task, logs }: { t: Copy; task: TaskRecord; logs: TaskLogRecord[] }) {
  const progress = desktopProgressEntries(logs);
  const stage = executionStage(t, task, logs, progress);
  const recentProgress = progress.slice(-5);
  const phaseItems = executionPhases(t, task, logs, progress);
  const latestMessage = latestMeaningfulLog(logs)?.message ?? t.noWorkerMessage;
  const approvalEvents = logs.filter((log) => log.message.toLowerCase().includes("approval")).length + (task.approvalRequest ? 1 : 0);

  return (
    <article className="execution-overview">
      <div className="execution-overview-title">
        <Activity size={15} />
        <strong>{t.executionOverview}</strong>
      </div>
      <div className="execution-overview-head">
        <div className="execution-state">
          <StatusIcon status={task.status} />
          <div>
            <span>{t.currentStage}</span>
            <strong>{stage}</strong>
          </div>
        </div>
        <StatusBadge t={t} status={task.status} />
      </div>

      <div className="execution-phase-strip" aria-label={t.executionOverview}>
        {phaseItems.map((item) => (
          <div key={item.key} className={`execution-phase ${item.state}`}>
            {item.state === "done" ? <CheckCircle2 size={15} /> : item.state === "active" ? <Activity size={15} /> : <CircleDot size={15} />}
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="execution-meta-grid">
        <div>
          <span>{t.runMode}</span>
          <strong>{modeLabel(task.mode, t)}</strong>
        </div>
        <div>
          <span>{t.attempt}</span>
          <strong>{task.attempt}{t.attemptSuffix}</strong>
        </div>
        <div>
          <span>{t.latestFeedback}</span>
          <strong>{new Date(task.updatedAt).toLocaleTimeString()}</strong>
        </div>
      </div>

      <div className="execution-signals-title">
        <Radio size={14} />
        <strong>{t.executionSignals}</strong>
      </div>
      <div className="execution-signal-grid">
        <div>
          <span>{t.feedbackCount}</span>
          <strong>{logs.length}</strong>
        </div>
        <div>
          <span>{t.approvalCount}</span>
          <strong>{approvalEvents}</strong>
        </div>
        <div>
          <span>{t.lastWorkerMessage}</span>
          <strong>{latestMessage}</strong>
        </div>
      </div>

      <div className="progress-timeline">
        <div className="progress-timeline-title">
          <ListChecks size={15} />
          <strong>{t.progressTimeline}</strong>
        </div>
        {recentProgress.length ? recentProgress.map((entry) => (
          <div key={entry.id} className="progress-step">
            <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
            <p>{entry.message}</p>
          </div>
        )) : <div className="progress-empty">{t.noProgressYet}</div>}
      </div>
    </article>
  );
}

function WorkerStrip({
  t,
  workers,
  workspaces,
  pairing,
  onPair
}: {
  t: Copy;
  workers: WorkerRecord[];
  workspaces: Array<WorkspaceRecord & { role: WorkspaceRole }>;
  pairing: PairingTokenResponse | null;
  onPair: () => void;
}) {
  const online = workers.filter((worker) => worker.status === "online").length;
  return (
    <section className="worker-strip">
      <div className="status-card">
        <Radio size={18} />
        <div>
          <span>{t.localWorkerOnline}</span>
          <strong>{online} / {workers.length}</strong>
          <small>{workspaces[0]?.name ?? t.personalWorkspace}</small>
        </div>
      </div>
      <div className="worker-list">
        {workers.length ? workers.map((worker) => (
          <span key={worker.id} className={`worker-pill ${worker.status}`}>
            <CircleDot size={14} />
            {worker.name}
          </span>
        )) : <span className="empty-text">{t.noWorkers}</span>}
      </div>
      <button className="secondary-button" onClick={onPair}>
        <KeyRound size={16} />
        {t.pairWorker}
      </button>
      <PairingCommand t={t} pairing={pairing} />
    </section>
  );
}

function PairingCommand({ t, pairing, standalone = false }: { t: Copy; pairing: PairingTokenResponse | null; standalone?: boolean }) {
  if (!pairing) return null;
  const recommended = pairing.recommendedCommand ?? pairing.desktopCommand ?? pairing.command;
  return (
    <div className={`pairing-command-group ${standalone ? "standalone" : ""}`}>
      <div className="pairing-command-block">
        <span>{t.recommendedWorkerCommand}</span>
        <code className="pairing-command">{recommended}</code>
      </div>
      {recommended !== pairing.command ? (
        <div className="pairing-command-block subtle">
          <span>{t.basicWorkerCommand}</span>
          <code className="pairing-command">{pairing.command}</code>
        </div>
      ) : null}
    </div>
  );
}

function TaskComposer({
  t,
  token,
  workers,
  onCreated
}: {
  t: Copy;
  token: string;
  workers: WorkerRecord[];
  onCreated: (task: TaskRecord) => void;
}) {
  const [workerId, setWorkerId] = useState("");
  const [mode, setMode] = useState<TaskMode>("shell");
  const [prompt, setPrompt] = useState("pwd && ls -la");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workerId && workers[0]) setWorkerId(workers[0].id);
  }, [workers, workerId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!workerId || !prompt.trim()) return;
    setLoading(true);
    try {
      const response = await authed<{ task: TaskRecord }>(token, "/api/tasks", {
        method: "POST",
        body: {
          workerId,
          mode,
          prompt,
          workingDirectory,
          idempotencyKey: `${workerId}:${mode}:${workingDirectory}:${prompt}`
        }
      });
      onCreated(response.task);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel composer">
      <div className="section-heading">
        <div>
          <h2>{t.newTask}</h2>
          <p>{t.newTaskSubtitle}</p>
        </div>
        <Play size={18} />
      </div>
      <form onSubmit={submit}>
        <div className="form-row">
          <label>
            {t.targetWorker}
            <select value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
              <option value="">{t.selectWorker}</option>
              {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
            </select>
          </label>
          <label>
            {t.runMode}
            <select value={mode} onChange={(event) => setMode(event.target.value as TaskMode)}>
            <option value="shell">{t.shell}</option>
            <option value="codex">{t.codex}</option>
            <option value="browser">{t.browser}</option>
            <option value="computer">{t.computer}</option>
          </select>
          </label>
        </div>
        <label className="full-width-field">
          {t.workingDirectory}
          <input value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} placeholder={t.workingDirectoryPlaceholder} />
        </label>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} />
        <button className="primary-button" disabled={!workers.length || loading} type="submit">
          <Play size={16} />
          {loading ? t.starting : t.startTask}
        </button>
      </form>
    </section>
  );
}

function TaskQueue({
  t,
  tasks,
  selectedTaskId,
  onSelect
}: {
  t: Copy;
  tasks: TaskRecord[];
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="panel queue">
      <div className="section-heading">
        <div>
          <h2>{t.runningNow}</h2>
          <p>{t.tasksInWorkspace(tasks.length)}</p>
        </div>
        <Activity size={18} />
      </div>
      <div className="task-list">
        {tasks.map((task) => (
          <button key={task.id} className={`task-row ${selectedTaskId === task.id ? "selected" : ""}`} onClick={() => onSelect(task.id)}>
            <StatusIcon status={task.status} />
            <span>
              <strong>{task.title}</strong>
              <small>
                {modeLabel(task.mode, t)} · {t.attempt} {task.attempt}{t.attemptSuffix}
                {task.nextRunAt ? ` · ${t.retryAt} ${new Date(task.nextRunAt).toLocaleTimeString()}` : ""}
                {" · "}
                {new Date(task.updatedAt).toLocaleTimeString()}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
        {!tasks.length ? <div className="empty-state">{t.createAfterPairing}</div> : null}
      </div>
    </section>
  );
}

function LiveConsole({
  t,
  task,
  logs,
  onApprove,
  onCancel,
  onRetry
}: {
  t: Copy;
  task: TaskRecord | null;
  logs: TaskLogRecord[];
  onApprove: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
}) {
  const canCancel = task && ["pending", "running", "waiting_user", "canceling"].includes(task.status);
  const canRetry = task && ["completed", "failed", "canceled"].includes(task.status);

  return (
    <section className="panel console-panel">
      <div className="section-heading">
        <div>
          <h2>{t.liveLogs}</h2>
          <p>{task ? task.title : t.waitingForTask}</p>
        </div>
        {task ? <StatusBadge t={t} status={task.status} /> : null}
      </div>
      {canCancel ? (
        <div className="console-actions">
          <button className="secondary-button danger" disabled={task.status === "canceling"} onClick={() => onCancel(task.id)}>
            <XCircle size={16} />
            {task.status === "canceling" ? t.canceling : t.cancelTask}
          </button>
        </div>
      ) : null}
      {canRetry ? (
        <div className="console-actions">
          <button className="secondary-button" onClick={() => onRetry(task.id)}>
            <Play size={16} />
            {t.retryTask}
          </button>
        </div>
      ) : null}
      {task?.status === "waiting_user" ? (
        <div className="approval-box">
          <ShieldAlert size={18} />
          <div>
            <strong>{t.requiresApproval}</strong>
            <p>{task.approvalReason}</p>
            {task.approvalRequest ? (
              <dl className="approval-details">
                <div><dt>{t.risk}</dt><dd>{task.approvalRequest.riskClass}</dd></div>
                <div><dt>{t.action}</dt><dd>{task.approvalRequest.action}</dd></div>
                {task.approvalRequest.workingDirectory ? <div><dt>{t.directory}</dt><dd>{task.approvalRequest.workingDirectory}</dd></div> : null}
                {task.approvalRequest.command ? <div><dt>{t.command}</dt><dd>{task.approvalRequest.command}</dd></div> : null}
              </dl>
            ) : null}
          </div>
          <button className="secondary-button amber" onClick={() => onApprove(task.id)}>{t.approve}</button>
        </div>
      ) : null}
      <div className="log-window">
        {logs.map((log) => (
          <div key={log.id} className={`log-line ${log.level}`}>
            <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
            <LogLevelIcon level={log.level} />
            <code>{log.message}</code>
          </div>
        ))}
        {!logs.length ? <div className="empty-state">{t.waitingForOutput}</div> : null}
      </div>
    </section>
  );
}

function ArtifactsPanel({ t, token, task }: { t: Copy; token: string; task: TaskRecord | null }) {
  return (
    <section className="panel artifacts">
      <div className="section-heading">
        <div>
          <h2>{t.artifacts}</h2>
          <p>{t.artifactsSubtitle}</p>
        </div>
        <Archive size={18} />
      </div>
      {task?.result ? <pre className="result-block">{task.result}</pre> : <div className="empty-state">{t.completedResults}</div>}
      {task?.artifacts.length ? (
        <div className="artifact-list">
          {task.artifacts.map((artifact) => (
            <ArtifactItem key={artifact.id} artifact={artifact} token={token} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ArtifactItem({ artifact, token }: { artifact: TaskArtifact; token: string }) {
  if (artifact.type === "file" || artifact.type === "url") {
    const href = artifactHref(artifact, token);
    const isImage = isImageArtifact(artifact);
    return (
      <a className={`artifact-row${isImage ? " artifact-row-image" : ""}`} href={href} target="_blank" rel="noreferrer">
        {isImage ? <img src={href} alt={artifact.name} /> : <Archive size={15} />}
        <span>
          <strong>{artifact.name}</strong>
          <small>{artifact.type}</small>
        </span>
      </a>
    );
  }

  return (
    <div className="artifact-row">
      <Archive size={15} />
      <span>
        <strong>{artifact.name}</strong>
        <small>{artifact.value}</small>
      </span>
    </div>
  );
}

function WorkersView({
  t,
  workers,
  workspaces,
  pairing,
  onPair,
  onUnbind
}: {
  t: Copy;
  workers: WorkerRecord[];
  workspaces: Array<WorkspaceRecord & { role: WorkspaceRole }>;
  pairing: PairingTokenResponse | null;
  onPair: () => void;
  onUnbind: (workerId: string) => void;
}) {
  const workspaceName = (workspaceId: string) => workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? t.unknownWorkspace;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>{t.localWorkers}</h2>
          <p>{t.localWorkersSubtitle}</p>
        </div>
        <button className="secondary-button" onClick={onPair}><KeyRound size={16} />{t.pairWorker}</button>
      </div>
      <PairingCommand t={t} pairing={pairing} standalone />
      <div className="worker-table">
        {workers.map((worker) => (
          <div key={worker.id} className="worker-card">
            <div className="worker-card-title">
              <Computer size={18} />
              <div>
                <strong>{worker.name}</strong>
                <small>{workspaceName(worker.workspaceId)} · {worker.status} · {t.lastSeen} {new Date(worker.lastSeenAt).toLocaleTimeString()}</small>
              </div>
              <button className="secondary-button danger worker-unbind-button" title={t.unbindWorkerTitle} type="button" onClick={() => onUnbind(worker.id)}>
                <XCircle size={15} />
                {t.unbindWorker}
              </button>
            </div>
            <div className="chip-row">
              {worker.capabilities.map((capability) => <span key={capability} className="chip">{capability}</span>)}
            </div>
            <div className="chip-row">
              {worker.allowedModes.map((mode) => <span key={mode} className="chip muted">{modeLabel(mode, t)} {t.allowed}</span>)}
            </div>
            <WorkerCapabilityMatrix t={t} worker={worker} />
            <div className="dir-list">
              <FolderLock size={16} />
              <span>{worker.allowedDirectories.length ? worker.allowedDirectories.join("\n") : t.noAllowlist}</span>
            </div>
            {worker.browserProfileDir ? (
              <div className="dir-list">
                <Globe size={16} />
                <span>{worker.browserProfileDir}</span>
              </div>
            ) : null}
            <div className="native-readiness">
              <div className="native-readiness-title">
                <Workflow size={15} />
                <strong>{t.nativeReadiness}</strong>
                {worker.nativeReadiness ? <span>{t.nativeBackend}: {worker.nativeReadiness.backend}</span> : null}
              </div>
              {worker.nativeReadiness ? <DesktopReadinessSummary worker={worker} t={t} /> : null}
              {worker.nativeReadiness ? (
                <div className="readiness-grid">
                  {nativeReadinessEntries(worker).map((entry) => (
                    <div key={entry.key} className={`readiness-item ${entry.status}`} title={entry.detail}>
                      {entry.status === "unavailable" ? <XCircle size={14} /> : entry.status === "warning" ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                      <span>{entry.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="readiness-empty">{t.readinessUnknown}</span>
              )}
            </div>
          </div>
        ))}
        {!workers.length ? <div className="empty-state">{t.pairWorkerEmpty}</div> : null}
      </div>
    </section>
  );
}

function desktopReadinessSummary(worker: WorkerRecord, t: Copy) {
  const readiness = worker.nativeReadiness;
  if (!readiness?.codexDesktopBridge?.ok) {
    return { status: "unavailable", label: t.desktopBridgeMissing };
  }
  if (readiness.codexDesktopSmoke?.ok) {
    return { status: "ready", label: t.desktopReady };
  }
  if (readiness.codexDesktopSmoke?.status === "warning") {
    return { status: "warning", label: t.desktopForegroundRequired };
  }
  return { status: "available", label: t.desktopSmokeDisabled };
}

function DesktopReadinessSummary({ worker, t }: { worker: WorkerRecord; t: Copy }) {
  const summary = desktopReadinessSummary(worker, t);
  return <span className={`desktop-readiness-summary ${summary.status}`}>{summary.label}</span>;
}

function SelectedWorkerHealth({ t, worker, mode }: { t: Copy; worker?: WorkerRecord; mode: TaskMode }) {
  if (!worker) {
    return (
      <div className="selected-worker-health">
        <div>
          <strong>{t.selectedWorkerHealth}</strong>
          <span>{t.selectWorker}</span>
        </div>
      </div>
    );
  }
  const health = workerModeHealth(worker, mode, t);
  return (
    <div className={`selected-worker-health ${health.state}`}>
      <div>
        <strong>{t.selectedWorkerHealth}</strong>
        <span>{t.selectedWorkerHealthSubtitle}</span>
      </div>
      <div className="selected-worker-health-status">
        {health.state === "ready" ? <CheckCircle2 size={15} /> : health.state === "warning" ? <AlertTriangle size={15} /> : <XCircle size={15} />}
        <span>{modeLabel(mode, t)} · {health.label}</span>
      </div>
    </div>
  );
}

function WorkerCapabilityMatrix({ t, worker }: { t: Copy; worker: WorkerRecord }) {
  const modes: TaskMode[] = ["shell", "codex", "browser", "computer"];
  return (
    <div className="worker-capability-matrix">
      <div className="worker-capability-title">
        <ShieldCheck size={15} />
        <strong>{t.capabilityMatrix}</strong>
        <span>{worker.status === "online" ? t.workerOnlineReady : t.workerOffline}</span>
      </div>
      <div className="worker-capability-grid">
        {modes.map((mode) => {
          const health = workerModeHealth(worker, mode, t);
          return (
            <div key={mode} className={`worker-capability-cell ${health.state}`} title={health.detail}>
              {health.state === "ready" ? <CheckCircle2 size={14} /> : health.state === "warning" ? <AlertTriangle size={14} /> : <XCircle size={14} />}
              <strong>{modeLabel(mode, t)}</strong>
              <span>{health.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function workerModeHealth(worker: WorkerRecord, mode: TaskMode, t: Copy) {
  const allowed = worker.allowedModes.includes(mode);
  if (worker.status !== "online") {
    return { state: "blocked", label: t.workerOffline, detail: worker.lastSeenAt };
  }
  if (!allowed) {
    return { state: "blocked", label: t.modeBlocked, detail: `${mode} is not in allowedModes` };
  }
  if (mode === "browser" || mode === "computer") {
    const readiness = worker.nativeReadiness;
    const desktopReady = Boolean(readiness?.backend === "desktop" && readiness.codexDesktopBridge?.ok && (readiness.codexDesktopSmoke?.ok || readiness.cuaDriver?.ok));
    const execReady = Boolean(readiness?.backend === "exec" && readiness.codexCli?.ok);
    const appServerReady = Boolean(readiness?.backend === "app-server" && readiness.codexAppServer?.ok);
    if (desktopReady || execReady || appServerReady) {
      return { state: "ready", label: t.browserComputerReady, detail: readiness?.codexDesktopSmoke?.detail ?? readiness?.codexCli?.detail ?? t.browserComputerReady };
    }
    return { state: "warning", label: t.browserComputerNeedsSetup, detail: readiness?.codexDesktopBridge?.detail ?? readiness?.codexCli?.detail ?? t.readinessUnknown };
  }
  return { state: "ready", label: t.modeReady, detail: worker.allowedDirectories.join("\n") || t.noAllowlist };
}

function nativeReadinessEntries(worker: WorkerRecord) {
  const readiness = worker.nativeReadiness;
  if (!readiness) return [];
  return [
    ["codexCli", "Codex CLI", readiness.codexCli],
    ["codexAppServer", "App Server", readiness.codexAppServer],
    ["codexDesktopBridge", "Desktop Bridge", readiness.codexDesktopBridge],
    ["codexDesktopSmoke", "Desktop Smoke", readiness.codexDesktopSmoke],
    ["cuaDriver", "CuaDriver", readiness.cuaDriver],
    ["chrome", "Chrome", readiness.chrome]
  ].flatMap(([key, label, check]) => {
    if (!check || typeof check !== "object") return [];
    return [{
      key: key as string,
      label: label as string,
      ok: check.ok,
      detail: check.detail,
      status: check.status ?? (check.ok ? "ready" : "unavailable")
    }];
  });
}

function WorkspaceFilesView({
  t,
  token,
  files,
  onUploadFile,
  onDeleteFile
}: {
  t: Copy;
  token: string;
  files: WorkspaceFileRecord[];
  onUploadFile: (file: File) => Promise<void>;
  onDeleteFile: (fileId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const filteredFiles = files.filter((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()));
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (!selected.length) return;
    setUploading(true);
    try {
      for (const file of selected) {
        await onUploadFile(file);
      }
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <section className="files-drive">
      <div className="files-drive-hero">
        <div>
          <h2>{t.workspaceFiles}</h2>
          <p>{t.workspaceFilesDriveSubtitle}</p>
        </div>
        <div className="files-drive-stats" aria-label={t.workspaceFiles}>
          <div>
            <span>{t.allFiles}</span>
            <strong>{files.length}</strong>
          </div>
          <div>
            <span>{t.matchingFiles}</span>
            <strong>{filteredFiles.length}</strong>
          </div>
          <div>
            <span>{t.serverStored}</span>
            <strong>{formatBytes(totalSize)}</strong>
          </div>
        </div>
        <label className="primary-button file-upload-button">
          <Upload size={16} />
          {uploading ? t.starting : t.uploadFile}
          <input multiple type="file" onChange={upload} />
        </label>
      </div>
      <div className="panel files-drive-panel">
        <div className="files-drive-toolbar">
          <label>
            {t.searchFiles}
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.fileName} />
          </label>
        </div>
        <div className="files-drive-table">
          <div className="files-drive-header">
            <span>{t.fileName}</span>
            <span>{t.fileSize}</span>
            <span>{t.fileUploadedAt}</span>
            <span />
          </div>
          {filteredFiles.map((file) => (
            <div key={file.id} className="files-drive-row">
              <span className="files-drive-name">
                <span className="file-type-icon"><FileText size={16} /></span>
                <strong>{file.name}</strong>
              </span>
              <span>{formatBytes(file.size)}</span>
              <span>{new Date(file.createdAt).toLocaleString()}</span>
              <span className="files-drive-actions">
                <a className="secondary-button" href={`${API}/api/workspace-files/${file.id}/download?token=${token}`} target="_blank" rel="noreferrer">
                  <Download size={15} />
                  {t.downloadFile}
                </a>
                <button className="secondary-button danger" type="button" onClick={() => onDeleteFile(file.id)}>
                  <Trash2 size={15} />
                  {t.deleteFile}
                </button>
              </span>
            </div>
          ))}
          {!filteredFiles.length ? <div className="empty-state files-empty">
            <FileText size={24} />
            <span>{t.noWorkspaceFiles}</span>
          </div> : null}
        </div>
      </div>
    </section>
  );
}

function AdminView({
  t,
  users,
  currentUserId,
  onCreateUser,
  onUpdateUser
}: {
  t: Copy;
  users: AdminUserSummary[];
  currentUserId: string;
  onCreateUser: (input: {
    email: string;
    password: string;
    workspaceName: string;
  }) => Promise<void>;
  onUpdateUser: (userId: string, input: { disabled?: boolean; password?: string }) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("codexbro-customer");
  const [workspaceName, setWorkspaceName] = useState("");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setMessage("");
    setError("");
    try {
      await onCreateUser({ email, password, workspaceName });
      setEmail("");
      setWorkspaceName("");
      setPassword("codexbro-customer");
      setMessage(t.userCreated);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t.loginFailed);
    } finally {
      setCreating(false);
    }
  }

  async function resetPassword(userId: string) {
    const nextPassword = resetPasswords[userId]?.trim();
    if (!nextPassword) return;
    await onUpdateUser(userId, { password: nextPassword });
    setResetPasswords((current) => ({ ...current, [userId]: "" }));
  }

  return (
    <div className="admin-grid">
      <section className="panel admin-create-panel">
        <div className="section-heading">
          <div>
            <h2>{t.createCustomer}</h2>
            <p>{t.adminUsersSubtitle}</p>
          </div>
          <UserCircle2 size={18} />
        </div>
        <form className="admin-form" onSubmit={submit}>
          <label>
            {t.customerEmail}
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            {t.initialPassword}
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="text" required />
          </label>
          <label>
            {t.customerWorkspace}
            <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Acme Workspace" />
          </label>
          {message ? <div className="form-success">{message}</div> : null}
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button" disabled={creating} type="submit">
            <KeyRound size={16} />
            {creating ? t.creating : t.createUser}
          </button>
        </form>
      </section>

      <section className="panel admin-users-panel">
        <div className="section-heading">
          <div>
            <h2>{t.adminUsers}</h2>
            <p>{t.adminUsersSubtitle}</p>
          </div>
          <ShieldCheck size={18} />
        </div>
        <div className="admin-user-list">
          {users.map((user) => (
            <article key={user.id} className="admin-user-row">
              <div className="admin-user-main">
                <UserCircle2 size={18} />
                <div>
                  <strong>{user.email}</strong>
                  <small>{user.platformRole === "admin" ? t.adminRole : t.customerRole} · {user.disabledAt ? t.disabled : t.active}</small>
                </div>
              </div>
              <div className="admin-user-workspaces">
                {user.workspaces.map((workspace) => (
                  <span key={workspace.id} className="chip muted">{workspace.name} · {workspace.role}</span>
                ))}
              </div>
              <div className="admin-user-actions">
                <input
                  value={resetPasswords[user.id] ?? ""}
                  onChange={(event) => setResetPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                  placeholder={t.newPassword}
                  type="text"
                />
                <button className="secondary-button" type="button" onClick={() => resetPassword(user.id)}>
                  <KeyRound size={15} />
                  {t.resetPassword}
                </button>
                <button
                  className={`secondary-button ${user.disabledAt ? "" : "danger"}`}
                  disabled={user.id === currentUserId}
                  type="button"
                  onClick={() => onUpdateUser(user.id, { disabled: !user.disabledAt })}
                >
                  {user.disabledAt ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  {user.disabledAt ? t.enableUser : t.disableUser}
                </button>
              </div>
            </article>
          ))}
          {!users.length ? <div className="empty-state">{t.usersEmpty}</div> : null}
        </div>
      </section>
    </div>
  );
}

function AuditView({ t, audits }: { t: Copy; audits: AuditEventRecord[] }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>{t.auditTrail}</h2>
          <p>{t.auditTrailSubtitle}</p>
        </div>
        <ShieldCheck size={18} />
      </div>
      <div className="audit-list">
        {audits.map((audit) => (
          <div key={audit.id} className="audit-row">
            <span>{new Date(audit.createdAt).toLocaleString()}</span>
            <strong>{audit.action}</strong>
            <p>{audit.summary}</p>
          </div>
        ))}
        {!audits.length ? <div className="empty-state">{t.auditEmpty}</div> : null}
      </div>
    </section>
  );
}

function SettingsView({ t, workers }: { t: Copy; workers: WorkerRecord[] }) {
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{t.executionGuardrails}</h2>
            <p>{t.currentSafetyControls}</p>
          </div>
          <ShieldAlert size={18} />
        </div>
        <ul className="settings-list">
          <li>{t.guardrailAllowlist}</li>
          <li>{t.guardrailApproval}</li>
          <li>{t.guardrailAudit}</li>
          <li>{t.guardrailBrowser}</li>
          <li>{t.guardrailWorkspace}</li>
          <li>{t.guardrailRoles}</li>
        </ul>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{t.workerLaunch}</h2>
            <p>{t.workerLaunchSubtitle}</p>
          </div>
          <Globe size={18} />
        </div>
        <pre className="result-block">{`npm run doctor:desktop

CODEXBRO_NATIVE_TASK_BACKEND=desktop \\
CODEXBRO_DESKTOP_ALLOW_FOREGROUND=true \\
CODEXBRO_DESKTOP_BRIDGE_SMOKE_READINESS=true \\
npm run worker -- \\
  --server http://localhost:4317 \\
  --pairing-token <token> \\
  --token-file .codexbro/worker-token.json \\
  --allowed-dir /path/to/project \\
  --allowed-mode shell \\
  --allowed-mode codex \\
  --allowed-mode browser \\
  --allowed-mode computer \\
  --browser-profile-dir /path/to/browser-profile`}</pre>
        <div className="settings-stat">
          <strong>{workers.length}</strong>
          <span>{t.registeredWorkers}</span>
        </div>
      </section>
      <DesktopLaunchChecklist t={t} workers={workers} />
    </div>
  );
}

function DesktopLaunchChecklist({ t, workers }: { t: Copy; workers: WorkerRecord[] }) {
  const preferredWorker = workers.find((worker) => worker.nativeReadiness?.backend === "desktop") ?? workers[0];
  const items = desktopLaunchChecklist(t, preferredWorker, workers.length);

  return (
    <section className="panel desktop-launch-panel">
      <div className="section-heading">
        <div>
          <h2>{t.desktopLaunchChecklist}</h2>
          <p>{t.desktopLaunchChecklistSubtitle}</p>
        </div>
        <ListChecks size={18} />
      </div>
      <div className="desktop-launch-worker">
        <Computer size={17} />
        <div>
          <strong>{preferredWorker?.name ?? t.noWorkers}</strong>
          <span>{preferredWorker ? `${preferredWorker.status} · ${preferredWorker.nativeReadiness?.backend ?? t.readinessUnknown}` : t.checklistNoWorker}</span>
        </div>
      </div>
      <div className="desktop-checklist">
        {items.map((item) => (
          <div key={item.label} className={`desktop-check-item ${item.status}`}>
            {item.status === "ready" ? <CheckCircle2 size={16} /> : item.status === "optional" ? <AlertTriangle size={16} /> : <XCircle size={16} />}
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            <small>{item.status === "ready" ? t.checklistReady : item.status === "optional" ? t.checklistOptional : t.checklistNeedsAttention}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function desktopLaunchChecklist(t: Copy, worker: WorkerRecord | undefined, workerCount: number) {
  const readiness = worker?.nativeReadiness;
  const modesReady = Boolean(worker?.allowedModes.includes("browser") && worker.allowedModes.includes("computer"));
  return [
    {
      label: t.checklistConnectedWorker,
      detail: workerCount ? worker?.name ?? t.localWorkerOnline : t.checklistNoWorker,
      status: workerCount ? "ready" : "unavailable"
    },
    {
      label: t.checklistDesktopBackend,
      detail: readiness?.backend === "desktop" ? t.desktopReady : t.checklistUseRecommendedCommand,
      status: readiness?.backend === "desktop" ? "ready" : "unavailable"
    },
    {
      label: t.checklistTaskModes,
      detail: modesReady ? `${t.browser} / ${t.computer}` : t.checklistAllowModes,
      status: modesReady ? "ready" : "unavailable"
    },
    {
      label: t.checklistDesktopBridge,
      detail: readiness?.codexDesktopBridge?.detail ?? t.desktopBridgeMissing,
      status: readiness?.codexDesktopBridge?.ok ? "ready" : "unavailable"
    },
    {
      label: t.checklistDesktopSmoke,
      detail: readiness?.codexDesktopSmoke?.detail ?? t.checklistSmokeHint,
      status: readiness?.codexDesktopSmoke?.ok ? "ready" : "unavailable"
    },
    {
      label: t.checklistCuaDriver,
      detail: readiness?.cuaDriver?.detail ?? t.checklistUseRecommendedCommand,
      status: readiness?.cuaDriver?.ok ? "ready" : "unavailable"
    },
    {
      label: t.checklistChrome,
      detail: readiness?.chrome?.detail ?? t.checklistUseRecommendedCommand,
      status: readiness?.chrome?.ok ? "ready" : "optional"
    }
  ] as Array<{ label: string; detail: string; status: "ready" | "unavailable" | "optional" }>;
}

function StatusIcon({ status }: { status: TaskRecord["status"] }) {
  if (status === "completed") return <CheckCircle2 className="status-icon completed" size={17} />;
  if (status === "canceled") return <XCircle className="status-icon canceled" size={17} />;
  if (status === "failed") return <XCircle className="status-icon failed" size={17} />;
  if (status === "waiting_user") return <ShieldAlert className="status-icon waiting" size={17} />;
  if (status === "running" || status === "canceling") return <Activity className="status-icon running" size={17} />;
  return <Clock3 className="status-icon pending" size={17} />;
}

function StatusBadge({ t, status }: { t: Copy; status: TaskRecord["status"] }) {
  return <span className={`status-badge ${status}`}>{t.status[status]}</span>;
}

function modeLabel(mode: TaskMode, t: Copy) {
  if (mode === "computer") return t.computer;
  if (mode === "browser") return t.browser;
  if (mode === "codex") return t.codex;
  return t.shell;
}

const desktopProgressPrefix = "[desktop progress] ";

function desktopProgressEntries(logs: TaskLogRecord[]) {
  return logs
    .filter((log) => log.message.includes(desktopProgressPrefix))
    .map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      message: log.message.slice(log.message.indexOf(desktopProgressPrefix) + desktopProgressPrefix.length).trim()
    }));
}

function latestMeaningfulLog(logs: TaskLogRecord[]) {
  return logs.slice().reverse().find((log) => !log.message.includes("Duplicate create request"));
}

function executionPhases(
  t: Copy,
  task: TaskRecord,
  logs: TaskLogRecord[],
  progress: Array<{ message: string }>
) {
  const claimed = task.status !== "pending" || logs.some((log) => log.message.includes("claimed the task") || log.message.includes("Task queued"));
  const executing = ["running", "waiting_user", "canceling", "completed", "failed", "canceled"].includes(task.status) || progress.length > 0 || logs.length > 1;
  const waiting = task.status === "waiting_user";
  const finished = ["completed", "failed", "canceled"].includes(task.status);
  const phases = [
    { key: "queued", label: t.stageQueued, reached: true, active: task.status === "pending" },
    { key: "claimed", label: t.stageClaimed, reached: claimed, active: task.status === "running" && !executing },
    { key: "executing", label: t.stageExecuting, reached: executing, active: task.status === "running" },
    { key: "approval", label: t.stageApproval, reached: waiting || Boolean(task.approvalGranted), active: waiting },
    { key: "finished", label: t.stageFinished, reached: finished, active: finished }
  ];
  return phases.map((phase) => ({
    ...phase,
    state: phase.active ? "active" : phase.reached ? "done" : "pending"
  }));
}

function executionStage(
  t: Copy,
  task: TaskRecord,
  logs: TaskLogRecord[],
  progress: Array<{ message: string }>
) {
  if (task.status === "waiting_user") return t.requiresApproval;
  if (task.status === "pending") return t.taskQueued;
  if (task.status === "canceling") return t.canceling;
  if (task.status === "completed" || task.status === "failed" || task.status === "canceled") return t.status[task.status];

  const latestProgress = progress[progress.length - 1]?.message;
  if (latestProgress) return latestProgress;
  if (logs.some((log) => log.message.includes("Submitting task to Codex Desktop bridge"))) return t.submittedToDesktop;
  if (logs.some((log) => log.message.includes("claimed the task"))) return t.workerClaimed;
  if (logs.length) return t.writingResult;
  return t.taskQueued;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function artifactHref(artifact: TaskArtifact, token: string) {
  return `${artifact.value}${artifact.value.includes("?") ? "&" : "?"}token=${token}`;
}

function isImageArtifact(artifact: TaskArtifact) {
  return /\.(apng|avif|gif|jpe?g|png|svg|webp)$/i.test(artifact.name);
}

function LogLevelIcon({ level }: { level: LogLevel }) {
  if (level === "stdout" || level === "stderr") return <Terminal size={14} />;
  if (level === "warn") return <ShieldAlert size={14} />;
  if (level === "error") return <XCircle size={14} />;
  return <CircleDot size={14} />;
}

function mergeLogs(current: TaskLogRecord[], log: TaskLogRecord) {
  if (current.some((item) => item.id === log.id)) return current;
  return [...current, log];
}

async function authed<T>(token: string, path: string, options: { method?: string; body?: unknown } = {}) {
  return request<T>(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error ?? response.statusText);
  }
  return (await response.json()) as T;
}

const rootElement = document.getElementById("root")!;
window.codexbroRoot ??= createRoot(rootElement);
window.codexbroRoot.render(
  <StrictMode>
    <App />
  </StrictMode>
);
