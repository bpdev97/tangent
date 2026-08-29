# Install Tangent

Tangent is a personal T3 Code distribution for running coding agents on your machine. Its macOS
app, iOS app, server package, data directory, and update feed are separate from upstream T3 Code.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the Tangent server.

At least one provider CLI, installed and authenticated. See [Providers](#providers) below.

## Run the Server Without Installing

Download `tangent-server-X.Y.Z.tgz` from the matching
[Tangent release](https://github.com/bpdev97/tangent/releases), then run it locally:

```bash
npx --yes ./tangent-server-X.Y.Z.tgz
```

This starts the Tangent server on your machine and opens the local web app. Use
`npx --yes ./tangent-server-X.Y.Z.tgz --help` for the full CLI reference. Do not use
`npx t3@latest` for a Tangent environment: that installs the upstream distribution and can create
client/server version skew.

## Desktop App

Download the latest Tangent macOS artifact from
[GitHub Releases](https://github.com/bpdev97/tangent/releases). Tangent does not currently publish
Windows, Linux desktop, Homebrew, Winget, or Arch packages.

The iOS build is distributed through TestFlight. It uses the `personal` EAS channel, so JavaScript
updates are delivered only to a compatible Tangent binary.

Nightly:

```bash
yay -S t3code-nightly-bin
```

### Windows Subsystem for Linux

When the desktop app runs a WSL backend, it installs the matching server runtime into
`~/.t3/wsl-runtime` inside the selected distro. The first launch after installing or updating T3
Code may take a little longer while that release's runtime is extracted. Later launches reuse the
Linux-local copy so startup does not depend on reading application files through `/mnt/c`. After a
successful launch, T3 Code keeps the current runtime and one previous runtime for rollback and
removes older caches automatically. If a cached runtime stops working, T3 Code launches from the
application files under `/mnt/c` instead and reinstalls the runtime on the next launch.

## Providers

Tangent drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider   | CLI                                                          | Default binary | Log in with           |
| ---------- | ------------------------------------------------------------ | -------------- | --------------------- |
| Codex      | [Codex CLI](https://developers.openai.com/codex/cli)         | `codex`        | `codex login`         |
| Claude     | [Claude Code](https://claude.com/product/claude-code)        | `claude`       | `claude auth login`   |
| Cursor     | [Cursor CLI](https://cursor.com/cli)                         | `cursor-agent` | `agent login`         |
| Grok Build | [Grok Build CLI](https://x.ai/cli)                           | `grok`         | `grok login`          |
| OpenCode   | [OpenCode](https://opencode.ai)                              | `opencode`     | `opencode auth login` |
| Hermes     | [Hermes Agent](https://github.com/NousResearch/hermes-agent) | `hermes`       | `hermes model`        |

Codex, Claude, Cursor, and Hermes are on by default. Grok Build and OpenCode are off by default;
turn them on in **Settings** → the provider's card when you want to use them.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
T3 Code looks for, but authenticate with `agent login`, not `cursor-agent login`.

Grok models that support adjustable reasoning show a **Reasoning** control beside the model picker.
The available levels and default come from the installed Grok Build CLI, so they can vary by model
and CLI version.

Run the login command on the machine running the Tangent server, not on the device you browse
from.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started Tangent.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
Tangent. You can install Tangent, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next Steps

- [Permission modes](./permission-modes.md): how much T3 Code asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
- [Keeping Tangent in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux and macOS background service
