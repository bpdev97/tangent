# Tangent

Tangent is my personal fork of [T3 Code](https://github.com/pingdotgg/t3code), a minimal web GUI
for coding agents. It carries a small distribution-specific layer while staying close to upstream.

## Installation

> [!WARNING]
> Tangent currently supports Codex, Claude, Cursor, and OpenCode.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Run the server without installing

Download `tangent-server-X.Y.Z.tgz` from the matching
[GitHub Release](https://github.com/bpdev97/tangent/releases), then run:

```bash
npx --yes ./tangent-server-X.Y.Z.tgz
```

Use `npx --yes ./tangent-server-X.Y.Z.tgz --help` for the full CLI reference.

### Desktop app

Install the latest Tangent desktop build from
[GitHub Releases](https://github.com/bpdev97/tangent/releases). The upstream package-manager
installers continue to install T3 Code rather than this fork.

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

There's no public docs site yet, checkout the miscellaneous markdown files in [docs](./docs).

## Documentation

- [Getting started](./docs/getting-started/quick-start.md)
- [Remote access](./docs/user/remote-access.md)
- [Keeping Tangent in sync](./docs/user/server-updates.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Provider guides](./docs/providers/codex.md)
- [Operations](./docs/operations/ci.md)
- [Reference](./docs/reference/encyclopedia.md)

## If you REALLY want to contribute still.... read this first

### Install `vp`

Tangent uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
