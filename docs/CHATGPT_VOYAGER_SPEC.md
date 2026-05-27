# ChatGPT Voyager 自用版功能需求说明

## 一、项目目标

把 `Nagi-ovo/gemini-voyager` 改造成一个仅供个人使用的 ChatGPT 管理插件，不上架 Chrome 商店。

目标不是完整复制 Gemini 页面体验，而是保留和改造对我有用的管理能力：

- Prompt Vault
- Timeline
- Starred Messages
- Folders
- Conversation Search
- Notes
- Google Drive Sync
- Diagnostics
- Fact Check
- Conversation Time Awareness
- Copy Reply as Image

## 二、核心原则

1. 不调用 ChatGPT 私有 API。
2. 不读取 cookies。
3. 不读取浏览历史。
4. 不申请 `all_urls`。
5. 不上传完整聊天正文。
6. 不同步完整聊天正文。
7. 不自动扫描所有历史对话。
8. 只处理用户主动打开过、归档过、收藏过或点击操作过的对话。
9. 权限最小化。
10. 所有重大功能先设计、再实现。
11. 每次只开发一个模块，构建通过后再进入下一步。

## 三、必须实现的功能

### 1. Prompt Vault

必须支持：

- 新建 prompt
- 编辑 prompt
- 删除 prompt
- 搜索 prompt
- prompt 标签
- prompt 收藏 / 置顶
- 插入 prompt 到 ChatGPT 输入框
- prompt JSON 导入 / 导出
- Google Drive 同步 prompt 数据

二阶段增强：

- prompt 变量
- 使用前弹出变量填写表单
- 自动生成完整 prompt 后插入输入框

### 2. Timeline

必须支持：

- 当前 ChatGPT 对话时间轴
- 识别用户消息和助手消息
- 每轮消息生成一个节点
- 节点显示摘要
- 点击节点滚动到对应消息
- 手动刷新时间轴
- 页面变化时自动更新

二阶段增强：

- 时间轴内搜索
- hover 预览
- 匹配关键词高亮

不做：

- 按日期跳转
- 每条消息时间戳展示
- 时间轴多层级

### 3. Starred Messages

必须支持：

- 收藏重要消息节点
- 可从 timeline 节点收藏
- 可从助手消息附近收藏
- 插件面板中查看收藏节点
- 点击收藏节点跳转到对应 ChatGPT 对话
- 当前就在对应对话时滚动到对应消息

只保存元数据：

- `conversationId`
- `conversationTitle`
- `messageAnchor`
- `messageRole`
- `snippet`，最多 100 字
- `folderId`
- `createdAt`
- `updatedAt`

不保存完整消息正文。

### 4. Folders / Conversation Index

必须支持：

- 插件自己的文件夹管理
- 最多二级文件夹
- 文件夹新建
- 文件夹重命名
- 文件夹删除
- 删除文件夹后，对话回到未分类
- 文件夹折叠展开
- 拖拽移动对话
- 移动对话时搜索文件夹
- 对话归档
- 对话备注
- 插件内对话搜索
- 对话 URL 索引
- 点击对话后普通跳转到 ChatGPT URL
- ChatGPT 原生标题变化时，同步更新插件中的对话标题

对话索引字段至少包括：

- `conversationId`
- `title`
- `url`
- `folderId`
- `note`
- `createdAt`
- `updatedAt`
- `lastOpenedAt`

不做：

- 不删除 ChatGPT 原始对话
- 不隐藏 ChatGPT 原生历史列表
- 不做无刷新切换
- 不做自动归档
- 不做文件夹颜色
- 不做文件夹复制
- 不做悬浮文件夹面板

### 5. Popup Dashboard

点击 Chrome 插件图标后打开总面板。

总面板至少包括：

- 当前页面状态
- 当前 `conversationId`
- 当前对话标题
- 当前消息节点数量
- 手动刷新当前对话信息
- Prompt Vault 入口
- Folders 入口
- Starred 入口
- Search 入口
- Sync 状态
- Diagnostics 入口

### 6. Options Page

设置页至少包括：

- Google Drive 同步设置
- 当前同步账号显示
- 手动立即同步
- 从云端拉取
- 上传并覆盖云端
- 重新授权
- 清除授权缓存
- 本地备份恢复
- 重置本地数据
- 插件版本号
- `schemaVersion`
- 诊断信息

### 7. Google Drive Sync

使用 Google Drive `appDataFolder`。

同步范围：

- prompt 库
- 文件夹结构
- 对话归档信息
- 收藏消息元数据
- 对话备注
- 插件设置
- 时间元数据

不同步：

- 完整聊天正文
- 附件
- 图片
- Canvas 内容
- 核查结果全文

必须支持：

- 自动同步
- 手动同步
- 同步状态提示
- 当前同步账号显示
- 重新授权
- OAuth reset
- `updatedAt` 新者优先的冲突处理
- 覆盖云端前自动本地备份
- `schemaVersion`
- 数据迁移
- 固定 extension ID

### 8. Diagnostics

诊断面板必须显示：

- 当前页面是否识别为 ChatGPT
- 当前 `conversationId`
- 当前对话标题
- 当前消息节点数量
- 当前是否已归档
- 当前收藏节点数量
- 上次同步时间
- 最近同步错误
- Google Drive 授权状态
- 本地数据 `schemaVersion`
- 插件版本号
- 一键复制诊断信息

限制：

- 不记录聊天正文
- 不上传诊断日志
- 不读取 cookies
- 不读取浏览历史

### 9. Fact Check / 核查回答

目标：

在每条 ChatGPT 助手回复下方操作按钮区域新增「核查回答」。

实现方式：

- 不接 Brave API
- 不接 Tavily API
- 不接 Google Search API
- 不使用收费搜索 API
- 不要求用户自己搜索
- 通过 ChatGPT 自身联网搜索能力完成核查

流程：

1. 用户点击某条助手回复下方的「核查回答」；
2. 插件提取当前单条助手回复；
3. 跳过代码块、表格、按钮、引用、非正文 UI；
4. 自动生成事实核查 prompt；
5. 自动打开新的 ChatGPT 临时核查对话；
6. 要求 ChatGPT 使用联网搜索核查事实陈述；
7. 要求输出结构化 JSON；
8. 插件读取 JSON；
9. 回到原回答中高亮事实陈述；
10. 按钮变成「核查结果」；
11. 点击「核查结果」显示详情面板；
12. 点击高亮陈述显示单条陈述详情。

高亮规则：

- 绿色：找到相似或支持来源；
- 橙色：存在出入或证据不足；
- 无高亮：非事实信息或无法评估。

重要提示：

- 绿色不代表绝对正确；
- 橙色不代表绝对错误；
- 只是基于搜索结果的辅助核查。

限制：

- 只处理用户主动点击的单条回复；
- 不自动扫描所有对话；
- 核查结果默认只本地保存；
- 不云同步完整核查结果；
- 不读取 cookies；
- 不调用 ChatGPT 私有 API；
- 不上传完整聊天正文到第三方 API。

如全自动读取 ChatGPT 临时核查结果不稳定，先实现半自动版：

- 自动生成核查 prompt；
- 自动打开新 ChatGPT 对话；
- 用户手动发送；
- 用户复制 JSON 回插件；
- 插件完成高亮。

### 10. Conversation Time Awareness / 对话时间感知

目标：

让插件记录对话时间元数据，并在必要时给 ChatGPT 注入极简时间上下文。

必须记录：

- `firstSeenAt`
- `lastOpenedAt`
- `lastUserMessageAt`
- `lastAssistantMessageAt`
- 每次用户发言时间
- 距离上次用户发言的间隔

上下文注入规则：

仅在以下情况之一发生时，在用户发送内容前加入极简时间上下文：

- 距离上次用户发言超过 6 小时；
- 用户输入很短，如“继续”“下一步”“接着来”；
- 用户使用相对时间词，如今天、昨天、明天、上周、刚才、之前；
- 用户点击「带时间上下文发送」。

注入格式：

```text
[插件时间上下文：
当前时间：YYYY-MM-DD HH:mm
本对话上次用户发言：YYYY-MM-DD HH:mm
间隔：X天X小时
]
```

限制：

- 默认不在界面显示每条消息时间戳；
- 不把时间戳插入所有消息；
- 不同步聊天正文；
- 时间元数据可以同步。

### 11. Copy Reply as Image / 单条回复转图片

目标：

在每条 ChatGPT 助手回复下方操作按钮区域新增「复制为图片」。

功能：

1. 只提取当前这一条助手回复；
2. 不截取整个页面；
3. 不包含 ChatGPT 侧边栏、输入框、按钮区、头像等无关 UI；
4. 保留正文排版，包括标题、列表、引用、代码块、加粗、链接文本；
5. 使用干净卡片样式渲染；
6. 输出 PNG；
7. 写入系统剪贴板；
8. 显示「已复制为图片，可直接粘贴」；
9. 如果剪贴板写入失败，提供下载 PNG 兜底；
10. 不上传图片；
11. 不保存图片；
12. 不同步图片。

## 四、明确不做的功能

以下功能不要实现：

- 对话导出
- Deep Research 导出
- Canvas 复制为 Markdown
- PDF / JSON / Markdown 聊天正文导出
- 完整聊天正文同步
- 批量删除对话
- 默认模型自动选择
- 多账号隔离
- 快捷键
- Vim Mode
- 页面视觉特效
- 行距调整
- 布局宽度调整
- 输入框折叠
- 文件夹颜色
- 文件夹复制
- 自动归档到项目
- 悬浮文件夹面板
- 隐藏 ChatGPT 原生最近对话
- Mermaid 预览
- 公式复制
- Gemini / AI Studio 专属功能
- Nano Banana 去水印
- Markdown 渲染修复
- Gem 类型图标
- 按日期跳转
- 时间轴多层级
- 快速建议按钮
- 自定义网站支持第一版不做
- AI Studio Enter-to-Send
- Prevent Auto Scroll

## 五、开发顺序建议

- P0：项目体检与基线构建
- P1：需求文档与实施计划
- P2：Adapter 抽象
- P3：ChatGPT 页面识别
- P4：Popup Dashboard 骨架
- P5：Prompt Vault 基础版
- P6：Folders 与 Conversation Index
- P7：Timeline 基础版
- P8：Starred Messages
- P9：Google Drive Sync
- P10：Diagnostics
- P11：Fact Check
- P12：Conversation Time Awareness
- P13：Copy Reply as Image
- P14：Timeline Search 与 Prompt Variables 增强

## 六、验收规则

每个阶段必须：

- 有清晰目标；
- 有涉及文件列表；
- 有验收标准；
- 修改后必须运行 `bun run build:chrome`；
- 构建失败时先修构建，不继续新功能；
- 不允许一次性大规模重构。
