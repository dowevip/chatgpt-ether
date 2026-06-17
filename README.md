[中文版](./README.zh-CN.md)

# ChatGPT Ether / ChatGPT以太

ChatGPT Ether is a personal-use / development Chrome extension for managing ChatGPT conversations. It adds local organization tools around the ChatGPT web page, including a right-side timeline, current conversation search, starred messages, folders, Prompt Vault, diagnostics, manual Google Drive sync, and conversation time context injection.

This project is adapted from earlier open source work. It is not an official OpenAI product, is not affiliated with OpenAI, and is not affiliated with Google.

## Current Status

ChatGPT Ether is currently maintained as a personal-use / development build. It is intended to be loaded from local source and reviewed before use. This repository does not claim a public Chrome Web Store release.

## Features

* Prompt Vault for saving and reusing prompts.
* Conversation folders and conversation index.
* Right-side conversation timeline on ChatGPT conversation pages.
* Current conversation search from the right-side timeline.
* Starred messages for important conversation turns.
* Diagnostics panel for inspecting extension state.
* Manual Google Drive sync for extension data.
* Conversation time context injection.
* Chinese and English Popup localization.
* Dark mode sync between the Popup and the page-side timeline panel.

## Install From Local Source

Requirements: Node.js-compatible tooling and network access for the build toolchain.

```bash
git clone <this-repository-url>
cd chatgpt-ether
npx --yes bun@latest install
npx --yes bun@latest run build:chrome
```

Then load the built extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select the generated `dist_chrome` directory.

## Privacy Summary

ChatGPT Ether reads the current ChatGPT page locally so it can build the timeline, search the current conversation, manage starred messages, and show diagnostics. Some extension data is stored locally in browser extension storage.

The extension does not sell user data, does not broadly read browsing history, does not read cookies, and does not upload screenshots, images, attachments, or Canvas content. Full chat transcripts are not uploaded by the extension.

If you are concerned about privacy, review the source code before installing or using the extension.

See [PRIVACY.md](./PRIVACY.md) for details.

## Google Drive Sync

Google Drive sync is manual and uses OAuth only for the sync feature. Sync data is stored in the user's own Google Drive `appDataFolder`.

When Google Drive sync is enabled, the extension may sync extension data such as prompts, folders, conversation index metadata, starred-message metadata, settings, and time metadata. It does not upload complete ChatGPT conversation transcripts.

The sync flow is designed for manual upload and download/merge actions; it is not intended to silently overwrite local data.

## Development Notes

* Primary Chrome build command: `npx --yes bun@latest run build:chrome`.
* Built extension output: `dist_chrome`.
* Some internal identifiers still use legacy names for compatibility with existing storage keys, CSS classes, message names, and sync data.
* Documentation cleanup does not imply that internal identifiers, repository names, or storage keys have been renamed.

## License and Credits

This project keeps the existing GPL-3.0 license. See [LICENSE](./LICENSE).

ChatGPT Ether is based on / adapted from [Nagi-ovo/gemini-voyager](https://github.com/Nagi-ovo/gemini-voyager). Timeline navigation ideas were also inspired by [Reborn14/chatgpt-conversation-timeline](https://github.com/Reborn14/chatgpt-conversation-timeline).

See [CREDITS.md](./CREDITS.md) and [NOTICE.md](./NOTICE.md) for attribution and compatibility notes.
