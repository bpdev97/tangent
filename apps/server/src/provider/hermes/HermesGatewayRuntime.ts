/**
 * HermesGatewayRuntime — the one supervised `hermes serve` backend owned by a
 * provider instance, plus the process-wide fleet the updater drains.
 *
 * The backend starts lazily on the first connection:
 * `hermes --profile <profile> serve --isolated --host 127.0.0.1 --port 0`,
 * with a fresh random `HERMES_DASHBOARD_SESSION_TOKEN` and `HERMES_DESKTOP`
 * removed (it would start Hermes's desktop cron ticker). The port comes from
 * the `HERMES_BACKEND_READY port=<n>` stdout sentinel; clients connect only to
 * 127.0.0.1 with that token. `stop` kills the process; the next connection
 * starts a new one with a new token.
 *
 * @module provider/hermes/HermesGatewayRuntime
 */
import * as NodeCrypto from "node:crypto";

import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  HermesGatewayClient,
  type HermesGatewayClientOptions,
  type HermesGatewayConnection,
  type HermesGatewayHandlers,
} from "./HermesGatewayClient.ts";
import {
  buildHermesGatewayArgs,
  finiteNumber,
  HermesGatewayError,
  record,
  text,
} from "./HermesGatewaySupport.ts";

const READY_PREFIX = "HERMES_BACKEND_READY port=";
const START_TIMEOUT_MS = 30_000;

/** What the running gateway said about itself in `session.info`. */
export interface HermesGatewayInfo {
  readonly version: string | null;
  readonly contract: number | null;
  readonly updateBehind: number | null;
  readonly updateCommand: string | null;
}

export interface HermesGatewayRuntime {
  readonly profile: string;
  readonly binaryPath: string;
  /**
   * Open one WebSocket connection. `answersServerRequests` advertises that
   * this connection handles approval and question requests (contract 7).
   */
  readonly connect: (
    handlers: HermesGatewayHandlers,
    options?: { readonly answersServerRequests?: boolean },
  ) => Effect.Effect<HermesGatewayConnection, HermesGatewayError>;
  /** Kill the backend. Connections close; the next `connect` restarts it. */
  readonly stop: Effect.Effect<void>;
  /** Latest self-description from any connection since the backend started. */
  readonly info: Effect.Effect<HermesGatewayInfo | null>;
  readonly noteInfo: (payload: unknown) => Effect.Effect<void>;
  /** Count of Hermes turns running on this backend; updates refuse while non-zero. */
  readonly activeTurns: Effect.Effect<number>;
  readonly trackTurn: Effect.Effect<Effect.Effect<void>>;
  /** While blocked, `connect` fails with `reason` (used during updates). */
  readonly blockStarts: (reason: string | null) => Effect.Effect<void>;
}

/**
 * Every live Hermes runtime in this server. The updater replaces the install
 * all instances run from, so it drains and stops all of them, not only the
 * instance whose update button was pressed.
 */
export const HermesGatewayFleet = Context.Reference<Set<HermesGatewayRuntime>>(
  "@t3tools/server/provider/hermes/HermesGatewayFleet",
  { defaultValue: () => new Set() },
);

export interface HermesGatewayRuntimeOptions {
  readonly binaryPath: string;
  readonly profile: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly clientOptions?: HermesGatewayClientOptions;
}

interface GatewayProcess {
  readonly port: number;
  readonly token: string;
  readonly scope: Scope.Closeable;
}

function gatewayEnvironment(environment: NodeJS.ProcessEnv, token: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...environment, HERMES_DASHBOARD_SESSION_TOKEN: token };
  delete env.HERMES_DESKTOP;
  return env;
}

export function parseHermesGatewayInfo(payload: unknown): Partial<HermesGatewayInfo> {
  const info = record(payload);
  const contract = finiteNumber(info.desktop_contract);
  const behind = finiteNumber(info.update_behind);
  return {
    ...(text(info.version) ? { version: text(info.version)!.trim() } : {}),
    ...(contract !== undefined ? { contract: Math.trunc(contract) } : {}),
    ...(behind !== undefined ? { updateBehind: Math.max(0, Math.trunc(behind)) } : {}),
    ...(text(info.update_command) ? { updateCommand: text(info.update_command)!.trim() } : {}),
  };
}

export const makeHermesGatewayRuntime = Effect.fn("makeHermesGatewayRuntime")(function* (
  options: HermesGatewayRuntimeOptions,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const parentScope = yield* Effect.scope;
  const startLock = yield* Semaphore.make(1);
  let current: GatewayProcess | null = null;
  let info: HermesGatewayInfo | null = null;
  let activeTurns = 0;
  let blockedReason: string | null = null;
  const executable = options.binaryPath || "hermes";

  const gatewayError = (detail: string, cause?: unknown) =>
    new HermesGatewayError({ detail, ...(cause === undefined ? {} : { cause }) });

  const stopProcess = Effect.suspend(() => {
    const running = current;
    current = null;
    info = null;
    return running === null ? Effect.void : Scope.close(running.scope, Exit.void);
  });

  const start = startLock.withPermit(
    Effect.gen(function* () {
      if (blockedReason !== null) return yield* gatewayError(blockedReason);
      if (current !== null) return current;

      const token = NodeCrypto.randomBytes(32).toString("base64url");
      const scope = yield* Scope.fork(parentScope, "sequential");
      const spawnInput = yield* resolveSpawnCommand(
        executable,
        buildHermesGatewayArgs(options.profile),
        { env: options.environment },
      ).pipe(Effect.mapError((cause) => gatewayError("Could not find the Hermes command.", cause)));
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(spawnInput.command, spawnInput.args, {
            env: gatewayEnvironment(options.environment, token),
            extendEnv: false,
            shell: spawnInput.shell,
          }),
        )
        .pipe(
          Effect.provideService(Scope.Scope, scope),
          Effect.mapError((cause) => gatewayError("Could not start the Hermes gateway.", cause)),
          Effect.onError(() => Scope.close(scope, Exit.void)),
        );

      const ready = yield* Deferred.make<number, HermesGatewayError>();
      yield* handle.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) => {
          if (!line.startsWith(READY_PREFIX)) return Effect.void;
          const port = Number.parseInt(line.slice(READY_PREFIX.length).trim(), 10);
          return Number.isInteger(port) && port > 0
            ? Deferred.succeed(ready, port).pipe(Effect.asVoid)
            : Effect.void;
        }),
        Effect.ignore,
        Effect.forkIn(scope),
      );
      // Raw stderr can carry provider details; it is drained, never surfaced.
      yield* handle.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkIn(scope));
      yield* handle.exitCode.pipe(
        Effect.flatMap((code) =>
          Effect.sync(() => {
            if (current?.scope === scope) {
              current = null;
              info = null;
            }
          }).pipe(
            Effect.andThen(
              Deferred.fail(
                ready,
                gatewayError(`Hermes gateway exited before becoming ready (code ${Number(code)}).`),
              ),
            ),
          ),
        ),
        Effect.ignore,
        Effect.forkIn(scope),
      );

      const port = yield* Deferred.await(ready).pipe(
        Effect.timeoutOption(START_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(gatewayError("Timed out waiting for the Hermes gateway.")),
            onSome: Effect.succeed,
          }),
        ),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      );
      current = { port, token, scope };
      return current;
    }),
  );

  const connect: HermesGatewayRuntime["connect"] = (handlers, connectOptions) =>
    Effect.gen(function* () {
      const gateway = yield* start;
      const client = new HermesGatewayClient(handlers, options.clientOptions);
      const url = `ws://127.0.0.1:${gateway.port}/api/ws?token=${encodeURIComponent(gateway.token)}`;
      yield* Effect.tryPromise({
        try: () => client.connect(url),
        catch: (cause) =>
          gatewayError(
            cause instanceof Error ? cause.message : "Could not connect to the Hermes gateway.",
            cause,
          ),
      });
      if (connectOptions?.answersServerRequests === true) {
        yield* Effect.tryPromise({
          try: () => client.request("client.capabilities", { server_requests: true }),
          catch: (cause) => gatewayError("The Hermes gateway rejected client capabilities.", cause),
        }).pipe(Effect.onError(() => Effect.sync(() => client.close())));
      }
      return client;
    });

  const runtime: HermesGatewayRuntime = {
    profile: options.profile,
    binaryPath: executable,
    connect,
    stop: startLock.withPermit(stopProcess),
    info: Effect.sync(() => info),
    noteInfo: (payload) =>
      Effect.sync(() => {
        const parsed = parseHermesGatewayInfo(payload);
        if (Object.keys(parsed).length === 0 || current === null) return;
        info = {
          version: parsed.version ?? info?.version ?? null,
          contract: parsed.contract ?? info?.contract ?? null,
          updateBehind: parsed.updateBehind ?? info?.updateBehind ?? null,
          updateCommand: parsed.updateCommand ?? info?.updateCommand ?? null,
        };
      }),
    activeTurns: Effect.sync(() => activeTurns),
    trackTurn: Effect.sync(() => {
      activeTurns += 1;
      let released = false;
      return Effect.sync(() => {
        if (released) return;
        released = true;
        activeTurns -= 1;
      });
    }),
    blockStarts: (reason) =>
      Effect.sync(() => {
        blockedReason = reason;
      }),
  };

  const fleet = yield* HermesGatewayFleet;
  fleet.add(runtime);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => fleet.delete(runtime)).pipe(Effect.andThen(runtime.stop)),
  );
  return runtime;
});
