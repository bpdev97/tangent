/**
 * Stateless calls on a provider instance's Hermes gateway: model and command
 * discovery, readiness, one-shot text generation, and the self-description the
 * snapshot and updater read. None of these add turns to a transcript.
 *
 * One lazily opened connection is shared and reopened after a disconnect.
 *
 * @module provider/hermes/HermesGatewayUtility
 */
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";

import type { HermesGatewayConnection, HermesGatewayEvent } from "./HermesGatewayClient.ts";
import type { HermesGatewayInfo, HermesGatewayRuntime } from "./HermesGatewayRuntime.ts";
import { HermesGatewayError, record, text } from "./HermesGatewaySupport.ts";

const DEFAULT_TIMEOUT_MS = 20_000;
/** A configured profile reports its version once its agent is built. */
const INFO_PROBE_TIMEOUT_MS = 20_000;

export interface HermesModelOptionProvider {
  readonly slug: string;
  readonly name: string;
  readonly authenticated?: boolean;
  readonly models?: ReadonlyArray<string>;
}

export interface HermesModelOptions {
  readonly model?: string;
  readonly provider?: string;
  readonly providers?: ReadonlyArray<HermesModelOptionProvider>;
}

export interface HermesCommandsCatalog {
  readonly pairs?: ReadonlyArray<readonly [name: string, description: string]>;
  readonly warning?: string;
}

export interface HermesSetupStatus {
  readonly provider_configured?: boolean | null;
}

export interface HermesGatewayUtility {
  readonly getModels: Effect.Effect<HermesModelOptions, HermesGatewayError>;
  readonly getCommands: Effect.Effect<HermesCommandsCatalog, HermesGatewayError>;
  readonly getSetupStatus: Effect.Effect<HermesSetupStatus, HermesGatewayError>;
  readonly generate: (prompt: string) => Effect.Effect<string, HermesGatewayError>;
  /**
   * The running gateway's version, contract, and update command. Probes with
   * a throwaway session when no session has reported them yet.
   */
  readonly readInfo: Effect.Effect<HermesGatewayInfo | null, HermesGatewayError>;
}

export const makeHermesGatewayUtility = Effect.fn("makeHermesGatewayUtility")(function* (
  runtime: HermesGatewayRuntime,
) {
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const events = yield* Queue.unbounded<HermesGatewayEvent>();
  let client: HermesGatewayConnection | undefined;
  let infoWaiter: { readonly sessionId: string; readonly done: Deferred.Deferred<void> } | null =
    null;

  yield* Queue.take(events).pipe(
    Effect.flatMap((event) =>
      Effect.gen(function* () {
        if (event.type === "session.info") yield* runtime.noteInfo(event.payload);
        const waiter = infoWaiter;
        if (waiter === null || event.session_id !== waiter.sessionId) return;
        // A profile without a model fails its agent build with `error` and never describes itself.
        if (
          event.type === "error" ||
          (event.type === "session.info" && text(record(event.payload).version) !== undefined)
        ) {
          yield* Deferred.succeed(waiter.done, undefined);
        }
      }),
    ),
    Effect.forever,
    Effect.forkIn(scope),
  );

  const getClient = Effect.suspend(() => {
    if (client) return Effect.succeed(client);
    let connection: HermesGatewayConnection | undefined;
    return runtime
      .connect({
        onEvent: (event) => Queue.offerUnsafe(events, event),
        onClose: () => {
          if (client === connection) client = undefined;
        },
      })
      .pipe(
        Effect.tap((opened) =>
          Effect.sync(() => {
            connection = opened;
            client = opened;
          }),
        ),
      );
  });

  const rpc = <T>(method: string, params: Readonly<Record<string, unknown>> = {}) =>
    getClient.pipe(
      Effect.flatMap((gateway) =>
        Effect.tryPromise({
          try: (signal) =>
            gateway.request<T>(method, params, { signal, timeoutMs: DEFAULT_TIMEOUT_MS }),
          catch: (cause) =>
            new HermesGatewayError({
              method,
              detail: cause instanceof Error ? cause.message : `Hermes request failed: ${method}`,
              cause,
            }),
        }),
      ),
    );

  const probeInfo = Effect.gen(function* () {
    const created = record(
      yield* rpc("session.create", {
        source: "t3-code",
        close_on_disconnect: true,
        hidden: true,
      }),
    );
    yield* runtime.noteInfo(created.info);
    const sessionId = text(created.session_id);
    if (!sessionId) return;
    const done = yield* Deferred.make<void>();
    infoWaiter = { sessionId, done };
    yield* Deferred.await(done).pipe(
      Effect.timeoutOption(INFO_PROBE_TIMEOUT_MS),
      Effect.ensuring(
        Effect.sync(() => {
          infoWaiter = null;
        }).pipe(
          Effect.andThen(rpc("session.close", { session_id: sessionId }).pipe(Effect.ignore)),
        ),
      ),
    );
  });

  const readInfo = lock.withPermit(
    Effect.gen(function* () {
      const known = yield* runtime.info;
      if (known?.version && known.updateCommand && known.contract !== null) return known;
      yield* probeInfo;
      return yield* runtime.info;
    }),
  );

  yield* Effect.addFinalizer(() => Effect.sync(() => client?.close()));

  return {
    getModels: lock.withPermit(rpc<HermesModelOptions>("model.options")),
    getCommands: lock.withPermit(rpc<HermesCommandsCatalog>("commands.catalog")),
    getSetupStatus: lock.withPermit(rpc<HermesSetupStatus>("setup.status")),
    generate: (prompt) =>
      lock.withPermit(
        rpc<{ readonly text?: string }>("llm.oneshot", {
          input: prompt,
          task: "t3_code",
          max_tokens: 2_048,
        }).pipe(Effect.map((result) => result.text ?? "")),
      ),
    readInfo,
  } satisfies HermesGatewayUtility;
});
