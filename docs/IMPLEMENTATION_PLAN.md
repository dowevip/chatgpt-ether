# ChatGPT Voyager 自用版实施计划

本文档基于 `docs/CHATGPT_VOYAGER_SPEC.md`，并结合当前仓库实际文件结构制定。实施原则是每次只推进一个模块，构建通过后再进入下一阶段。

## P0：项目体检与基线构建，已完成

### 阶段目标

- 确认当前仓库可以安装依赖并完成 Chrome 构建。
- 明确现有入口、manifest、构建输出目录和主要功能目录。

### 需要修改或关注的文件路径

- `package.json`
- `bun.lock`
- `manifest.json`
- `manifest.dev.json`
- `vite.config.chrome.ts`
- `vite.config.base.ts`
- `src/pages/content/index.tsx`
- `src/pages/popup/index.tsx`
- `src/pages/options/index.tsx`
- `src/pages/background/index.ts`
- `dist_chrome/`

### 具体任务

- 检查依赖是否已安装。
- 使用项目推荐的 Bun 流程安装依赖。
- 运行 Chrome 构建。
- 确认构建输出目录为 `dist_chrome/`。
- 确认 Chrome 加载未打包扩展应选择 `dist_chrome/`。

### 明确不做的事项

- 不修改业务代码。
- 不修改 manifest。
- 不修改构建配置。
- 不实现任何 ChatGPT 适配功能。

### 验收标准

- `node_modules/` 已存在。
- `dist_chrome/` 已生成。
- Chrome 构建成功。
- 基线信息已记录。

### 构建命令

```bash
bun run build:chrome
```

## P1：需求文档与实施计划

### 阶段目标

- 锁定 ChatGPT Voyager 自用版需求范围。
- 明确必须实现、二阶段增强和明确不做的功能。
- 制定分阶段实施计划。

### 需要修改或关注的文件路径

- `docs/CHATGPT_VOYAGER_SPEC.md`
- `docs/IMPLEMENTATION_PLAN.md`

### 具体任务

- 创建并维护 `docs/CHATGPT_VOYAGER_SPEC.md`。
- 创建本实施计划文档。
- 确认后续实现必须以需求文档为准。
- 每个功能进入开发前，先核对对应阶段的目标和不做事项。

### 明确不做的事项

- 不修改业务代码。
- 不修改 manifest。
- 不修改构建配置。
- 不实现任何功能。

### 验收标准

- `docs/CHATGPT_VOYAGER_SPEC.md` 存在且格式正确。
- `docs/IMPLEMENTATION_PLAN.md` 存在且覆盖 P0 至 P14。
- 每个阶段都有目标、路径、任务、不做事项、验收标准和构建命令。

### 构建命令

```bash
bun run build:chrome
```

## P2：Adapter 抽象

### 阶段目标

- 抽象页面适配层，为 Gemini 旧逻辑和 ChatGPT 新逻辑提供统一接口。
- 只抽象页面识别、消息节点读取、输入框定位、标题读取、conversationId 提取等适配能力。
- 保留 Gemini 旧逻辑，不删除、不重写、不做大规模迁移。

### 需要修改或关注的文件路径

- `src/pages/content/index.tsx`
- `src/core/utils/selectors.ts`
- `src/core/utils/conversationIdentity.ts`
- `src/core/utils/gemini.ts`
- `src/core/services/DOMService.ts`
- 可新增：`src/core/adapters/types.ts`
- 可新增：`src/core/adapters/geminiAdapter.ts`
- 可新增：`src/core/adapters/chatgptAdapter.ts`
- 可新增：`src/core/adapters/index.ts`

### 具体任务

- 定义 `PageAdapter` 或同等接口。
- 接口至少覆盖：
  - 判断当前页面是否支持；
  - 获取 `conversationId`；
  - 获取当前对话标题；
  - 获取用户消息节点；
  - 获取助手消息节点；
  - 获取 ChatGPT 输入框；
  - 获取助手回复操作按钮区域；
  - 为消息生成稳定 `messageAnchor`。
- 将 Gemini 现有选择器整理为 Gemini adapter 的实现或包装层。
- 创建 ChatGPT adapter 的空实现或最小占位实现，但不启用业务功能。

### 明确不做的事项

- 不删除 Gemini 旧逻辑。
- 不迁移所有旧功能。
- 不启用 ChatGPT 业务功能。
- 不修改 manifest 权限。
- 不做 UI。

### 验收标准

- 新 adapter 类型可以被 TypeScript 正确引用。
- Gemini 旧入口仍能构建。
- 没有移除原 Gemini 功能代码。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P3：ChatGPT 页面识别

### 阶段目标

- 只实现 ChatGPT 页面识别与当前会话基础信息读取。
- 不实现 Prompt、Timeline、Folders、Starred 等具体业务功能。

### 需要修改或关注的文件路径

- `src/pages/content/index.tsx`
- `src/pages/background/index.ts`
- `src/core/adapters/chatgptAdapter.ts`
- `src/core/adapters/index.ts`
- `src/core/utils/conversationIdentity.ts`
- `manifest.json`
- `manifest.dev.json`

### 具体任务

- 识别 `chatgpt.com` 页面。
- 识别 ChatGPT conversation URL。
- 提取当前 `conversationId`。
- 提取当前对话标题。
- 统计当前页面用户消息和助手消息节点数量。
- 在 content script 内只输出可被 popup 查询的状态。
- 如需要新增 host permission，仅加入 ChatGPT 必需域名，不申请 `all_urls`。

### 明确不做的事项

- 不实现 Prompt Vault。
- 不实现 Timeline。
- 不实现 Folders。
- 不实现 Starred Messages。
- 不读取 cookies。
- 不读取浏览历史。
- 不调用 ChatGPT 私有 API。
- 不自动扫描历史对话。

### 验收标准

- 打开 ChatGPT 对话页时可以识别为 ChatGPT。
- 能读取当前 `conversationId`、标题和消息节点数量。
- 非 ChatGPT 页面不会误判为 ChatGPT。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P4：Popup Dashboard 骨架

### 阶段目标

- 点击 Chrome 插件图标后显示 ChatGPT Voyager 总面板骨架。
- 展示当前页面状态和入口按钮，但不实现各入口背后的完整功能。

### 需要修改或关注的文件路径

- `src/pages/popup/index.tsx`
- `src/pages/popup/Popup.tsx`
- `src/pages/popup/index.css`
- `src/pages/popup/components/CloudSyncSettings.tsx`
- `src/pages/background/index.ts`
- `src/pages/content/index.tsx`
- `src/core/types/common.ts`

### 具体任务

- 在 popup 中展示当前页面状态。
- 展示当前 `conversationId`。
- 展示当前对话标题。
- 展示当前消息节点数量。
- 增加手动刷新当前对话信息按钮。
- 增加入口按钮：
  - Prompt Vault
  - Folders
  - Starred
  - Search
  - Sync
  - Diagnostics
- 建立 popup 与 content/background 的最小消息通信。

### 明确不做的事项

- 不实现 Prompt Vault 数据编辑。
- 不实现文件夹管理。
- 不实现 timeline。
- 不实现同步逻辑。
- 不引入复杂导航框架。

### 验收标准

- Popup 可打开。
- 在 ChatGPT 对话页能显示基础状态。
- 非 ChatGPT 页面显示未识别或不可用状态。
- 所有入口按钮存在但未承诺完整功能。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P5：Prompt Vault 基础版

### 阶段目标

- 实现 Prompt Vault 基础功能。
- 支持 prompt 的增删改查、标签、收藏/置顶、导入导出和插入到 ChatGPT 输入框。
- 第一版不做 prompt 变量。

### 需要修改或关注的文件路径

- `src/pages/content/prompt/index.ts`
- `src/pages/content/prompt/importPayload.ts`
- `src/pages/content/prompt/promptClickAction.ts`
- `src/pages/content/prompt/compactTitle.ts`
- `src/features/backup/services/PromptImportExportService.ts`
- `src/features/backup/types/backup.ts`
- `src/core/services/StorageService.ts`
- `src/core/types/common.ts`
- `src/core/adapters/chatgptAdapter.ts`
- `src/pages/popup/Popup.tsx`

### 具体任务

- 复用或改造现有 Prompt Manager 存储结构。
- 支持新建、编辑、删除 prompt。
- 支持搜索 prompt。
- 支持 prompt 标签。
- 支持 prompt 收藏或置顶。
- 支持 JSON 导入和导出。
- 通过 ChatGPT adapter 定位输入框并插入 prompt。
- 为后续 Google Drive Sync 保留清晰数据 schema。

### 明确不做的事项

- 不做 prompt 变量。
- 不做变量填写表单。
- 不自动生成完整 prompt。
- 不支持自定义网站。
- 不同步完整聊天正文。

### 验收标准

- Prompt 可以新建、编辑、删除、搜索。
- 标签和收藏/置顶可用。
- JSON 导入导出可用。
- 在 ChatGPT 页面可以插入 prompt 到输入框。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P6：Folders 与 Conversation Index

### 阶段目标

- 实现插件自己的文件夹管理和 ChatGPT 对话索引。
- 只管理插件内索引和跳转，不删除、不隐藏、不控制 ChatGPT 原生历史列表。

### 需要修改或关注的文件路径

- `src/pages/content/folder/manager.ts`
- `src/pages/content/folder/index.ts`
- `src/pages/content/folder/types.ts`
- `src/features/folder/services/FolderImportExportService.ts`
- `src/features/folder/types/import-export.ts`
- `src/core/types/folder.ts`
- `src/core/types/common.ts`
- `src/core/services/StorageService.ts`
- `src/core/adapters/chatgptAdapter.ts`
- `src/pages/popup/Popup.tsx`

### 具体任务

- 定义 ChatGPT conversation index schema。
- 字段至少包括：
  - `conversationId`
  - `title`
  - `url`
  - `folderId`
  - `note`
  - `createdAt`
  - `updatedAt`
  - `lastOpenedAt`
- 支持最多二级文件夹。
- 支持文件夹新建、重命名、删除。
- 删除文件夹后，对话回到未分类。
- 支持折叠展开。
- 支持拖拽移动对话。
- 移动对话时支持搜索文件夹。
- 支持对话归档、备注、插件内搜索和 URL 跳转。
- ChatGPT 原生标题变化时，同步更新插件中的标题。

### 明确不做的事项

- 不删除 ChatGPT 原始对话。
- 不隐藏 ChatGPT 原生历史列表。
- 不做无刷新切换。
- 不做自动归档。
- 不做文件夹颜色。
- 不做文件夹复制。
- 不做悬浮文件夹面板。

### 验收标准

- 文件夹和二级文件夹管理可用。
- 对话可归档、备注、搜索、移动。
- 点击插件内对话后跳转到 ChatGPT URL。
- 标题变更能同步到本地索引。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P7：Timeline 基础版

### 阶段目标

- 实现当前 ChatGPT 对话的基础时间轴。
- 每轮消息生成节点，点击节点滚动到对应消息。

### 需要修改或关注的文件路径

- `src/pages/content/timeline/index.ts`
- `src/pages/content/timeline/manager.ts`
- `src/pages/content/timeline/types.ts`
- `src/pages/content/timeline/EventBus.ts`
- `src/core/types/timeline.ts`
- `src/core/adapters/chatgptAdapter.ts`
- `src/pages/content/index.tsx`

### 具体任务

- 通过 ChatGPT adapter 获取用户消息和助手消息。
- 为每轮消息生成 timeline 节点。
- 节点显示短摘要。
- 点击节点滚动到对应消息。
- 提供手动刷新时间轴能力。
- 页面变化时自动更新。
- 只处理当前打开的对话。

### 明确不做的事项

- 不做时间轴内搜索。
- 不做 hover 预览。
- 不做关键词高亮。
- 不做按日期跳转。
- 不展示每条消息时间戳。
- 不做时间轴多层级。

### 验收标准

- 当前 ChatGPT 对话可生成 timeline。
- 用户消息和助手消息可以识别。
- 节点摘要可见。
- 点击节点能滚动到对应消息。
- 页面变化后 timeline 可更新。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P8：Starred Messages

### 阶段目标

- 实现重要消息收藏。
- 只保存收藏元数据，不保存完整消息正文。

### 需要修改或关注的文件路径

- `src/pages/content/timeline/StarredMessagesService.ts`
- `src/pages/content/timeline/starredTypes.ts`
- `src/pages/content/timeline/starredLookup.ts`
- `src/pages/content/timeline/manager.ts`
- `src/pages/popup/components/StarredHistory.tsx`
- `src/pages/popup/Popup.tsx`
- `src/core/types/common.ts`
- `src/core/services/StorageService.ts`
- `src/core/adapters/chatgptAdapter.ts`

### 具体任务

- 定义 Starred Message 元数据 schema。
- 字段包括：
  - `conversationId`
  - `conversationTitle`
  - `messageAnchor`
  - `messageRole`
  - `snippet`
  - `folderId`
  - `createdAt`
  - `updatedAt`
- 限制 `snippet` 最多 100 字。
- 支持从 timeline 节点收藏。
- 支持从助手消息附近收藏。
- Popup 中查看收藏节点。
- 点击收藏节点跳转到对应 ChatGPT 对话。
- 当前已在对应对话时滚动到对应消息。

### 明确不做的事项

- 不保存完整消息正文。
- 不同步完整消息正文。
- 不自动扫描所有对话。
- 不做全文收藏搜索。

### 验收标准

- 收藏和取消收藏可用。
- Popup 能查看收藏节点。
- 跳转和当前页滚动可用。
- 存储中没有完整消息正文。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P9：Google Drive Sync

### 阶段目标

- 使用 Google Drive `appDataFolder` 同步插件数据。
- 同步 prompt、文件夹、归档、收藏元数据、备注、设置和时间元数据。
- 不同步完整聊天正文。

### 需要修改或关注的文件路径

- `src/core/services/GoogleDriveSyncService.ts`
- `src/core/types/sync.ts`
- `src/core/services/SettingsBackupService.ts`
- `src/core/services/DataBackupService.ts`
- `src/pages/popup/components/CloudSyncSettings.tsx`
- `src/pages/background/index.ts`
- `src/utils/merge.ts`
- `manifest.json`
- `manifest.dev.json`

### 具体任务

- 将 Drive 存储目标设计为 `appDataFolder`。
- 定义同步 payload 和 `schemaVersion`。
- 同步范围：
  - prompt 库
  - 文件夹结构
  - 对话归档信息
  - 收藏消息元数据
  - 对话备注
  - 插件设置
  - 时间元数据
- 支持自动同步和手动同步。
- 显示同步状态和当前同步账号。
- 支持重新授权和 OAuth reset。
- 使用 `updatedAt` 新者优先处理冲突。
- 覆盖云端前自动本地备份。
- 支持数据迁移。
- 确保使用固定 extension ID。

### 明确不做的事项

- 不同步完整聊天正文。
- 不同步附件。
- 不同步图片。
- 不同步 Canvas 内容。
- 不同步核查结果全文。
- 不申请 `all_urls`。
- 不读取 cookies。

### 验收标准

- Drive 同步使用 `appDataFolder`。
- 手动上传、拉取和自动同步可用。
- 授权状态和账号显示可用。
- 冲突处理符合 `updatedAt` 新者优先。
- 覆盖云端前能生成本地备份。
- 同步 payload 不包含完整聊天正文。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P10：Diagnostics

### 阶段目标

- 实现诊断面板，帮助确认当前页面识别、索引、收藏和同步状态。
- 诊断只本地显示，不上传日志。

### 需要修改或关注的文件路径

- `src/pages/popup/Popup.tsx`
- 可新增：`src/pages/popup/components/DiagnosticsPanel.tsx`
- `src/pages/background/index.ts`
- `src/pages/content/index.tsx`
- `src/core/services/GoogleDriveSyncService.ts`
- `src/core/services/StorageService.ts`
- `src/core/utils/version.ts`
- `src/core/types/common.ts`

### 具体任务

- 显示当前页面是否识别为 ChatGPT。
- 显示当前 `conversationId`、标题和消息节点数量。
- 显示当前是否已归档。
- 显示当前收藏节点数量。
- 显示上次同步时间和最近同步错误。
- 显示 Google Drive 授权状态。
- 显示本地数据 `schemaVersion`。
- 显示插件版本号。
- 提供一键复制诊断信息。

### 明确不做的事项

- 不记录聊天正文。
- 不上传诊断日志。
- 不读取 cookies。
- 不读取浏览历史。
- 不调用外部诊断服务。

### 验收标准

- 诊断面板可从 Popup 进入。
- 诊断信息可复制。
- 诊断信息不包含完整聊天正文。
- 非 ChatGPT 页面有清晰状态。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P11：Fact Check / 核查回答

### 阶段目标

- 在用户主动点击单条助手回复时，生成并执行事实核查流程。
- 第一版优先尝试自动流程；如全自动读取 ChatGPT 临时核查结果不稳定，可落为半自动版。

### 需要修改或关注的文件路径

- 可新增：`src/pages/content/factCheck/index.ts`
- 可新增：`src/pages/content/factCheck/promptBuilder.ts`
- 可新增：`src/pages/content/factCheck/resultParser.ts`
- 可新增：`src/pages/content/factCheck/highlighter.ts`
- 可新增：`src/pages/content/factCheck/types.ts`
- `src/pages/content/index.tsx`
- `src/core/adapters/chatgptAdapter.ts`
- `src/core/services/StorageService.ts`
- `src/core/types/common.ts`

### 具体任务

- 在每条 ChatGPT 助手回复下方操作按钮区域新增「核查回答」。
- 提取当前单条助手回复正文。
- 跳过代码块、表格、按钮、引用和非正文 UI。
- 自动生成事实核查 prompt。
- 自动打开新的 ChatGPT 临时核查对话。
- 要求 ChatGPT 使用联网搜索核查事实陈述。
- 要求输出结构化 JSON。
- 读取 JSON 并回到原回答中高亮事实陈述。
- 按钮变成「核查结果」。
- 点击「核查结果」显示详情面板。
- 点击高亮陈述显示单条陈述详情。
- 如自动读取结果不稳定，改为半自动版：
  - 自动生成核查 prompt；
  - 自动打开新 ChatGPT 对话；
  - 用户手动发送；
  - 用户复制 JSON 回插件；
  - 插件完成高亮。

### 明确不做的事项

- 不接 Brave API。
- 不接 Tavily API。
- 不接 Google Search API。
- 不使用收费搜索 API。
- 不自动扫描所有对话。
- 不云同步完整核查结果。
- 不读取 cookies。
- 不调用 ChatGPT 私有 API。
- 不上传完整聊天正文到第三方 API。

### 验收标准

- 单条助手回复下方出现「核查回答」。
- 只处理用户点击的单条回复。
- 代码块、表格和非正文 UI 不参与核查文本。
- 支持绿色、橙色和无高亮三种结果。
- 结果面板能显示核查说明。
- 自动流程不稳定时，半自动流程可完成高亮。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P12：Conversation Time Awareness

### 阶段目标

- 记录对话时间元数据。
- 在必要时向 ChatGPT 输入框注入极简时间上下文。

### 需要修改或关注的文件路径

- `src/pages/content/timestamp/TimestampService.ts`
- 可新增：`src/pages/content/timeAwareness/index.ts`
- 可新增：`src/pages/content/timeAwareness/types.ts`
- `src/pages/content/sendBehavior/index.ts`
- `src/pages/content/utils/inputHelper.ts`
- `src/core/services/StorageService.ts`
- `src/core/types/common.ts`
- `src/core/adapters/chatgptAdapter.ts`

### 具体任务

- 记录：
  - `firstSeenAt`
  - `lastOpenedAt`
  - `lastUserMessageAt`
  - `lastAssistantMessageAt`
  - 每次用户发言时间
  - 距离上次用户发言的间隔
- 判断是否需要注入时间上下文：
  - 距离上次用户发言超过 6 小时；
  - 用户输入很短，如“继续”“下一步”“接着来”；
  - 用户使用相对时间词；
  - 用户点击「带时间上下文发送」。
- 注入规格文档中定义的极简时间上下文。
- 时间元数据允许参与云同步。

### 明确不做的事项

- 默认不显示每条消息时间戳。
- 不把时间戳插入所有消息。
- 不同步聊天正文。
- 不改变普通发送行为，除非触发注入规则。

### 验收标准

- 当前对话时间元数据可记录。
- 触发条件满足时可注入极简时间上下文。
- 未触发时不注入。
- 时间元数据不包含完整消息正文。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P13：Copy Reply as Image

### 阶段目标

- 在用户主动点击单条助手回复时，将该回复即时渲染为 PNG 并写入剪贴板。
- 该功能不属于聊天导出功能，不提供批量导出或完整对话导出。

### 需要修改或关注的文件路径

- 可新增：`src/pages/content/copyReplyImage/index.ts`
- 可新增：`src/pages/content/copyReplyImage/renderer.ts`
- 可新增：`src/pages/content/copyReplyImage/styles.ts`
- `src/pages/content/export/responseActionImageButton.ts`
- `src/pages/content/export/responseImageCopy.ts`
- `src/features/export/services/ImageRenderService.ts`
- `src/core/adapters/chatgptAdapter.ts`
- `src/pages/content/index.tsx`

### 具体任务

- 在每条 ChatGPT 助手回复下方操作按钮区域新增「复制为图片」。
- 只提取当前单条助手回复。
- 不截取整个页面。
- 排除侧边栏、输入框、按钮区、头像等无关 UI。
- 保留正文排版，包括标题、列表、引用、代码块、加粗和链接文本。
- 使用干净卡片样式渲染。
- 输出 PNG。
- 写入系统剪贴板。
- 成功后提示「已复制为图片，可直接粘贴」。
- 剪贴板失败时提供下载 PNG 兜底。

### 明确不做的事项

- 不做对话导出。
- 不做 PDF / JSON / Markdown 聊天正文导出。
- 不截取整个页面。
- 不上传图片。
- 不保存图片。
- 不同步图片。
- 不自动批量处理回复。

### 验收标准

- 单条助手回复下方出现「复制为图片」。
- 点击后生成当前回复 PNG。
- PNG 不包含无关 UI。
- 剪贴板写入成功时可直接粘贴。
- 剪贴板失败时可下载 PNG。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```

## P14：Timeline Search 与 Prompt Variables 增强

### 阶段目标

- 在基础功能稳定后，增强 Timeline 搜索和 Prompt 变量能力。

### 需要修改或关注的文件路径

- `src/pages/content/timeline/manager.ts`
- `src/pages/content/timeline/TimelinePreviewPanel.ts`
- `src/pages/content/timeline/types.ts`
- `src/pages/content/prompt/index.ts`
- `src/pages/content/prompt/promptClickAction.ts`
- `src/core/adapters/chatgptAdapter.ts`
- `src/core/services/StorageService.ts`
- `src/core/types/common.ts`

### 具体任务

- Timeline 增强：
  - 时间轴内搜索；
  - hover 预览；
  - 匹配关键词高亮。
- Prompt Variables 增强：
  - 支持 prompt 变量；
  - 使用前弹出变量填写表单；
  - 自动生成完整 prompt 后插入 ChatGPT 输入框。

### 明确不做的事项

- 不做按日期跳转。
- 不显示每条消息时间戳。
- 不做时间轴多层级。
- 不同步完整聊天正文。
- 不自动扫描所有历史对话。

### 验收标准

- Timeline 搜索可用。
- hover 预览可用。
- 关键词高亮可用。
- Prompt 变量填写和插入可用。
- Chrome 构建成功。

### 构建命令

```bash
bun run build:chrome
```
