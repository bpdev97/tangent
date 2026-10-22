// Tangent(FORK-LAUNCHER-001)
// The background service runs a lone copy of this executable at a fixed path, with no
// node_modules beside it. Upstream's `__service-launcher` fast path in bin.ts starts it before the
// full CLI loads; this probe lets an install confirm a copy has that path before using it.

/** Printed by `t3 __service-launcher --check`; a build without the fast path cannot print it. */
export const SERVICE_LAUNCHER_CHECK_OUTPUT = "t3-service-launcher: standalone";

export function runServiceLauncherCheck(): void {
  process.stdout.write(`${SERVICE_LAUNCHER_CHECK_OUTPUT}\n`);
}
