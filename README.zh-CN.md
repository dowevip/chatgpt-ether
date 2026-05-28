\# ChatGPT Ether / ChatGPT以太



ChatGPT以太是一款个人自用 / 开发中的 Chrome 扩展，用于管理 ChatGPT 对话。它围绕 ChatGPT 网页增加了一组本地化管理能力，包括右侧时间轴、当前对话搜索、消息收藏、对话文件夹、提示词库、诊断信息、Google Drive 手动同步，以及对话时间上下文注入。



本项目基于早期开源项目改造而来。它不是 OpenAI 官方产品，与 OpenAI 无隶属关系，也与 Google 无隶属关系。



\## 当前状态



ChatGPT以太目前是个人自用 / 开发版本，适合从本地源码构建并加载使用。使用前建议自行审查代码。本仓库不声称已经发布 Chrome Web Store 公开版本。



\## 功能



\* 提示词库：保存和复用常用提示词。

\* 对话文件夹与对话索引。

\* ChatGPT 对话页面右侧时间轴。

\* 基于右侧时间轴的当前对话搜索。

\* 收藏重要对话消息。

\* 诊断信息面板，用于查看扩展运行状态。

\* Google Drive 手动同步扩展数据。

\* 对话时间上下文注入。

\* Popup 支持中文和英文切换。

\* Popup 夜间模式与页面右侧时间轴同步。



\## 从本地源码安装



要求：具备 Node.js 兼容工具链，并能访问构建所需网络资源。



```bash

git clone <this-repository-url>

cd chatgpt-voyager

npx --yes bun@latest install

npx --yes bun@latest run build:chrome

```



然后加载构建后的扩展：



1\. 打开 `chrome://extensions`。

2\. 开启“开发者模式”。

3\. 点击“加载已解压的扩展程序”。

4\. 选择生成的 `dist\_chrome` 目录。



\## 隐私摘要



ChatGPT以太会在本地读取当前 ChatGPT 页面内容，用于生成时间轴、搜索当前对话、管理收藏消息，以及展示诊断信息。部分扩展数据会存储在浏览器扩展本地存储中。



本扩展不出售用户数据，不广泛读取浏览历史，不读取 cookies，不上传截图、图片、附件或 Canvas 内容。本扩展不会上传完整的 ChatGPT 聊天记录。



如果你对隐私有顾虑，建议在安装或使用前自行审查源码。



详细说明见 \[PRIVACY.md](./PRIVACY.md)。



\## Google Drive 同步



Google Drive 同步为手动同步功能，OAuth 仅用于该同步功能。同步数据存储在用户自己的 Google Drive `appDataFolder` 中。



启用 Google Drive 同步后，扩展可能会同步提示词、文件夹、对话索引元数据、收藏消息元数据、设置和时间元数据等扩展数据。本扩展不会上传完整的 ChatGPT 对话正文。



同步流程设计为手动上传和手动下载 / 合并，不用于静默覆盖本地数据。



\## 开发说明



\* Chrome 构建命令：`npx --yes bun@latest run build:chrome`。

\* 构建输出目录：`dist\_chrome`。

\* 为兼容既有存储键、CSS 类名、消息名和同步数据，部分内部标识仍保留历史命名。

\* 文档清理不代表内部标识、仓库名或存储键已经完成重命名。



\## 许可证与致谢



本项目保留现有 GPL-3.0 许可证。详见 \[LICENSE](./LICENSE)。



ChatGPT以太基于 / 改造自 \[Nagi-ovo/gemini-voyager](https://github.com/Nagi-ovo/gemini-voyager)。时间轴导航思路也受到 \[Reborn14/chatgpt-conversation-timeline](https://github.com/Reborn14/chatgpt-conversation-timeline) 启发。



归属说明和兼容性说明见 \[CREDITS.md](./CREDITS.md) 与 \[NOTICE.md](./NOTICE.md)。



