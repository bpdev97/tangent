import type { ProviderDriverKind } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export interface ProviderMaintenanceCapabilities {
  readonly provider: ProviderDriverKind;
  readonly packageName: string | null;
  readonly update: ProviderMaintenanceCommandAction | null;
  /** undefined defers to npm; null means the installer could not determine the latest version. */
  readonly latestVersion?: string | null;
  /**
   * Deferred until update checks are enabled; `null` falls back to
   * `latestVersion`, then npm.
   */
  readonly lookupLatestVersion?: Effect.Effect<string | null>;
  readonly compareVersions?: (current: string, latest: string) => number;
  /** Resolved executable path for advisories when no update command is proven. */
  readonly installPath?: string;
}

export interface ProviderMaintenanceCommandAction {
  readonly command: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly lockKey: string;
  /** Native updaters must use the instance's custom home (e.g. `CODEX_HOME`). */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Tangent(FORK-HERMES-001): wraps the command run, e.g. to drain and stop
   * provider processes first. A failure is reported as the update's failure.
   */
  readonly guard?: <A, E, R>(run: Effect.Effect<A, E, R>) => Effect.Effect<A, E | Error, R>;
}
