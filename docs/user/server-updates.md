# Keeping Tangent in Sync

The Tangent web or desktop app and a connected server work best on the same version. If they do not
match, Tangent shows the appropriate update action for that server.

## Where to Find the Update

You may see the warning:

- above the message box in the current conversation;
- in **Settings** → **Connections**, beside the affected connection.

Dismissing the conversation warning only hides that reminder for those two versions. It does not
update the server.

## Before You Update

Let active agent work and terminal commands finish first. Updating restarts the server, so its
connection disappears briefly and in-flight work may be interrupted. Saved threads, settings, and
project files are not removed.

## Choose the Action You See

| Action                     | What it does                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Update server**          | Downloads the matching `tangent-server-X.Y.Z.tgz` and checksum from the Tangent GitHub Release, verifies SHA-256, installs and preflights it, then restarts and reconnects the server. |
| **Update the desktop app** | Directs you to update the Tangent desktop app on the machine supervising that server.                                                                                                  |
| **Copy update command**    | Copies an exact `npx --yes https://github.com/bpdev97/tangent/...tgz` command for a server that cannot replace itself.                                                                 |

Tangent never substitutes the upstream npm `t3` package for these operations. The available action
depends on how the server was started, and Tangent does not update connected servers silently.

For a systemd-managed host, you can also install the latest Tangent server asset directly and run:

```sh
t3 service update
```

See [Running Tangent in the Background](./background-service.md) for installation, status, and
removal commands.

## After the Update

Keep the web or desktop app open while the server restarts. When it reconnects with the matching
version, the warning disappears.

If the client reports a timeout, the server may still be finishing the update. Wait a minute, then
reconnect or reopen **Settings** → **Connections**. If the warning remains:

1. Retry the offered action once.
2. Make sure you updated the machine named in the warning.
3. For a command-line server, use the copied GitHub Release command with the client version shown
   in the warning.

For connection setup and access troubleshooting, see [Remote Access](./remote-access.md).
