# Install Tangent

Tangent runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

Command-line use, SSH hosts, and WSL backends need Node.js 22.16+ (22.x), 23.11+
(23.x), or 24.10 and later. The native desktop app includes its server runtime.

You need an installed, authenticated provider before starting a thread. You can
launch Tangent and configure providers afterwards.

## Run without installing

```bash
npx --yes https://github.com/bpdev97/tangent/releases/download/personal-v<version>/tangent-server-<version>.tgz
```

This starts the server and opens the local web app. Run
`npx --yes https://github.com/bpdev97/tangent/releases/download/personal-v<version>/tangent-server-<version>.tgz --help` for command-line options.

## Desktop app

Download the macOS Apple Silicon DMG from [Tangent Releases](https://github.com/bpdev97/tangent/releases). Use the version shown there in the commands on this page.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install Node.js and provider CLIs inside that distro. Tangent installs its
matching server runtime there automatically; the first launch after an app
update can take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
npx --yes https://github.com/bpdev97/tangent/releases/download/personal-v<version>/tangent-server-<version>.tgz app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `npx --yes https://github.com/bpdev97/tangent/releases/download/personal-v<version>/tangent-server-<version>.tgz app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Install Tangent from its personal TestFlight distribution, then connect it to your server over LAN or Tailscale with a pairing URL. See [remote access](./remote-access.md).

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Codex       | Install [Codex CLI](https://developers.openai.com/codex/cli), then run `codex login`.                             |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                      |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                             |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                          |
| Hermes      | Install [Hermes Agent](https://hermes-agent.nousresearch.com/) and run `hermes setup`. See [Hermes](./hermes.md). |
| Antigravity | Install and sign in with Google from Tangent's provider settings.                                                 |

Provider CLIs must be on the server's `PATH`. If Tangent cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Antigravity can use its managed runtime without a `PATH` entry.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, Tangent does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md), and
[Antigravity](./providers-antigravity.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating Tangent](./updating.md): update the app and connected servers.
