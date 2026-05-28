[中文版](./PRIVACY.zh-CN.md)
# Privacy

ChatGPT Ether / ChatGPT以太 is a local Chrome extension for ChatGPT conversation management.

## What The Extension Reads

- The extension reads the current ChatGPT page content locally to provide the right-side timeline, current conversation search, starred messages, and diagnostics.
- Some data is stored locally in browser extension storage so extension features can work across sessions.
- OAuth is used only for Google Drive sync.

## What The Extension Does Not Do

- The extension does not sell user data.
- The extension does not read browsing history broadly.
- The extension does not read cookies.
- The extension does not upload full chat transcripts.
- The extension does not upload screenshots, images, attachments, or Canvas content.

## Google Drive Sync

Google Drive sync stores only extension data / metadata defined by the sync payload. Sync data is stored in the user's own Google Drive `appDataFolder`.

Google Drive authorization is used only to support manual sync actions. Users should review sync behavior and source code before using sync on sensitive data.

## Review Before Use

This is a self-use / development version. If you are concerned about privacy or data handling, review the source code before installing or using the extension.
