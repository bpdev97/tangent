# Chats

Chats are conversations that are not attached to a repository: questions, writing, planning, quick
lookups. They use the same providers, models, attachments, and thread history as project work.

## Start a chat

- **Web and desktop:** **Chats** appears in the sidebar like any other project, and **New thread
  in…** in the command palette lists it too. To start a chat from the keyboard, bind `chats.new`
  in **Settings → Keybindings**; it has no default shortcut.
- **iPhone and iPad:** the compose button on Home starts a chat. Tap **Chats** in the draft, or go
  back, to pick a different project. **Chats** also appears in the new-task project list and the
  project filter, which lists your chats.

Each server keeps its own Chats list, and chats from every connected server appear together under
**Chats**. A chat stays on the server where it started.

## What chats can do

Chats keep the terminal, which is useful for general tasks. Files, diffs, Git, branches, worktrees,
and project scripts are hidden, because there is no project behind a chat.

The agent runs in a scratch directory that the app manages. It is not a sandbox: agents follow
their provider's normal tools and your permission mode. New chats start in **Supervised** mode, so
approval requests appear in the conversation. See [permission modes](permission-modes.md).
