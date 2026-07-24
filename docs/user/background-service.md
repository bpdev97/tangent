# Running Tangent in the Background

On a Linux host, Tangent can run as a systemd user service. It starts when the machine boots and
keeps running after you log out.

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

## Using It with T3 Connect

T3 Connect may offer to install the service during setup so the host stays reachable after you log
out. This is only an onboarding shortcut: the service and T3 Connect are managed separately.

Signing out of T3 Connect does not remove the service. Use `t3 service uninstall` when you no longer
want Tangent to start in the background.

The background service currently requires Linux with systemd.
