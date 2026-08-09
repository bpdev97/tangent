# Chats

Chats are conversations that are not attached to a repository. They use the same providers and
thread history as project work, while hiding project-only tools such as files, Git, worktrees, and
terminals.

Choose **Chat Host** in Settings to decide which environment starts every new chat. If that host is
unavailable, the draft remains on the device until the host returns; Tangent does not move it to a
different environment. Existing chats remain on the environment where they started.

On iPhone, the composer at the bottom of Home starts a chat immediately. Search, New Thread,
filters, and Settings are available from the top navigation bar. New Thread continues to open the
traditional project-based flow.

![Chat-first iPhone home](./images/chats/ios-home.png)

The Home composer keeps the same provider, model, reasoning, and attachment controls as a thread
composer.

![iPhone chat model settings](./images/chats/ios-model-settings.png)

On desktop, the Chats section shows the selected Chat Host without taking another row of sidebar
space.

![Desktop Chats section](./images/chats/desktop-chats.png)

## Raycast Quick Chat

The macOS app accepts the fixed action `bpdev-code-action://quick-chat`. A Raycast script command
can open that URL and own the global hotkey. Tangent decides what happens next:

- if the last viewed chat is still inside the resume window, it reopens that chat;
- otherwise it opens a fresh chat draft on the selected Chat Host;
- **Always start new** disables resuming.

Configure the resume window under **Settings → General → Quick Chat**. This action does not change
normal Dock activation behavior.
