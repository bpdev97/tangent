# Running Tangent in the Background

On Linux and macOS, Tangent can run as a background service for your user, so it is ready without
keeping a terminal open.

## Install the Service

Download the `tangent-server-X.Y.Z.tgz` asset from the matching
[Tangent GitHub Release](https://github.com/bpdev97/tangent/releases), install it, and then install
the service:

```sh
npm install --global ./tangent-server-X.Y.Z.tgz
t3 service install
```

The package keeps the `t3` executable name for command-line compatibility, but its contents come
from the Tangent release. Service setup never fetches the upstream `t3` package from npm.

## Manage the Service

```sh
t3 service status
t3 service update
t3 service uninstall
```

`service update` reconciles the unit with the Tangent CLI currently running the command. To move to
a newer release manually, install that release asset first and then run `t3 service update`.

Updating restarts Tangent briefly. Let active agent work and terminal commands finish first.

Install and update refuse to replace a newer service with an older Tangent release. T3 Connect
setup also leaves a newer service unchanged. To intentionally downgrade, install the exact older
Tangent release asset and run:

```sh
t3 service update --allow-downgrade
```

If a remote update is already in progress, wait for it to finish before retrying a local update.

The service runs a small stable launcher. Exact Tangent versions are installed separately, so
a failed remote candidate can return to the previous version without rewriting the service
definition. The
launcher snapshots the database before a remote candidate starts, so database updates roll back
with the server version. An older launcher may require one local `service update` before this is
available.

## Platform Support

**Linux** uses a systemd user unit at `~/.config/systemd/user/tangent.service`. The service starts
when the machine boots and keeps running after you log out (lingering is enabled during install).

**macOS** uses a launch agent at `~/Library/LaunchAgents/com.bpdev97.tangent.service.plist`. It
starts when you log in, not when the Mac boots, and it stops when you log out; macOS has no
equivalent of Linux lingering for user agents. For a Mac that should stay reachable unattended,
turn on automatic login (System Settings → Users & Groups; unavailable while FileVault is on) and
keep the Mac from sleeping.

A few more macOS notes:

- Installing over SSH needs someone logged in at the Mac's screen to start the agent right away.
  Without that, the install command reports an error at the final start step, but the agent is
  fully installed and starts at the next login.
- macOS may show privacy prompts for protected folders such as Desktop, Documents, or Downloads,
  attributed to a bare `node` process, or deny access without a prompt. If agent work fails to
  read those folders, grant Full Disk Access to the node binary listed in the launch agent's
  `ProgramArguments`.
- The agent appears under System Settings → General → Login Items. If it was switched off there,
  or disabled with `launchctl disable`, macOS will not start it at login until you switch it back
  on.

**Windows** is not supported yet.

## Using It with T3 Connect

T3 Connect may offer to install the service during setup so the host stays reachable in the
background. This is only an onboarding shortcut: the service and T3 Connect are managed separately.

Signing out of T3 Connect does not remove the service. Use `t3 service uninstall` when you no longer
want Tangent to start in the background.
