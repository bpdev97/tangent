// Tangent(FORK-LAUNCHER-001)
// The background service runs a lone copy of this executable at a fixed path, with no
// node_modules beside it, so the launcher has to start before the full CLI module graph loads.
import { main } from "./serviceLauncher.ts";

/** Printed by `t3 __service-launcher --check`; a build without this fast path cannot print it. */
export const SERVICE_LAUNCHER_CHECK_OUTPUT = "t3-service-launcher: standalone";

export async function runServiceLauncherFastPath(args: ReadonlyArray<string>): Promise<void> {
  if (args[0] === "--check") {
    process.stdout.write(`${SERVICE_LAUNCHER_CHECK_OUTPUT}\n`);
    return;
  }
  try {
    await main();
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    process.stderr.write(`[service-launcher] ${error.message}\n`);
    process.exitCode = 1;
  }
}
