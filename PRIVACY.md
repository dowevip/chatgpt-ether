# Privacy

Language: **English** | [中文](./PRIVACY.zh-CN.md)

This privacy notice applies to ChatGPT Ether.

ChatGPT Ether is a Chrome extension for personal use. It enhances conversation management on the ChatGPT web app. It is not an official OpenAI product and does not represent OpenAI.

## Core Principles

ChatGPT Ether is designed to handle only the minimum data required for its features.

The extension does not:

- Read cookies
- Read browsing history
- Request `all_urls`
- Call ChatGPT private APIs
- Automatically scan all historical conversations
- Upload full chat transcripts
- Sync full chat transcripts
- Sell user data

## What the Extension Reads

When you open a `https://chatgpt.com/*` page, the extension reads page structure and message nodes related to its features, including:

- Building the current conversation timeline
- Searching within the current conversation
- Locating user messages or assistant replies
- Starring important messages
- Saving the current conversation index
- Inserting prompts into the input box
- Showing diagnostics

This reading happens in the current page context and is used mainly for immediate features and local state.

## Locally Stored Data

The extension stores the following data in browser extension local storage:

- Prompt Vault data
- Folder structure
- Saved conversation index
- Conversation notes
- Starred-message metadata
- Extension settings
- Timeline visibility state
- Floating button / floating panel positions
- Google Drive sync state

Starred messages store only necessary metadata and short snippets, not full message bodies.

## Data That Is Not Stored or Uploaded

The extension does not intentionally store or sync:

- Full ChatGPT chat transcripts
- Full assistant replies
- Attachments
- Images
- Canvas content
- Screenshots
- Large raw conversation JSON
- Browsing history
- Cookies

Current conversation search and timeline features may temporarily use message text in page memory, but full text is not written into extension sync data.

## Google Drive Sync

Google Drive sync is a manual feature. The extension uses the Google Drive API only after you explicitly authorize it and click a sync action.

Sync data is stored in your own Google Drive `appDataFolder`. This folder normally does not appear in the regular Google Drive file list.

Data allowed for sync:

- Prompt Vault data
- Folder structure
- Conversation index
- Conversation notes
- Starred-message metadata
- Extension settings
- Necessary time metadata

Data not synced:

- Full chat transcripts
- Full assistant replies
- Images, attachments, or screenshots
- Canvas content
- Large raw conversation JSON

Google Drive authorization is used only for the extension's own sync file, not to read your regular Drive files or personal file list.

## Diagnostics

The diagnostics panel only displays extension runtime state, such as:

- Whether the current page is recognized as ChatGPT
- Current conversationId
- Current message counts
- Timeline state
- Starred-message count
- Sync status
- Extension version

Diagnostics are not uploaded automatically. Copying diagnostics requires an explicit click.

## Third-Party Services

ChatGPT Ether does not send your data to third-party search APIs, analytics services, or advertising services.

If you use Google Drive sync, the allowed sync data is sent to Google Drive. This is explicitly authorized and triggered by you.

## Recommendation

This project is still in an early stage and is recommended for personal use or small-scale testing.

If you are concerned about privacy or data handling, review the source code before installing it, and be cautious when enabling Google Drive sync.
