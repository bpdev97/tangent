import type { HermesSettings } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { type ProviderAdapterError, ProviderAdapterRequestError } from "../Errors.ts";
import type { HermesGatewayConnection } from "./HermesGatewayClient.ts";
import { makeHermesGatewayRuntime, type HermesGatewayRuntime } from "./HermesGatewayRuntime.ts";
import { HERMES_DRIVER_KIND } from "./HermesGatewaySupport.ts";

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

export interface HermesGatewayUtility {
  readonly getModels: Effect.Effect<HermesModelOptions, ProviderAdapterError>;
  readonly getCommands: Effect.Effect<HermesCommandsCatalog, ProviderAdapterError>;
  readonly getSetupStatus: Effect.Effect<
    { readonly provider_configured?: boolean },
    ProviderAdapterError
  >;
  readonly generate: (input: {
    readonly modelId?: string | undefined;
    readonly prompt: string;
  }) => Effect.Effect<
    { readonly text: string; readonly response: { readonly stopReason: "end_turn" } },
    ProviderAdapterError
  >;
}

export const makeHermesGatewayUtility = Effect.fn("makeHermesGatewayUtility")(function* (
  settings: Pick<HermesSettings, "binaryPath" | "profile">,
  environment: NodeJS.ProcessEnv = process.env,
  providedRuntime?: HermesGatewayRuntime,
): Effect.fn.Return<
  HermesGatewayUtility,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> {
  const runtime = providedRuntime ?? (yield* makeHermesGatewayRuntime(settings, environment));
  const lock = yield* Semaphore.make(1);
  let client: HermesGatewayConnection | undefined;
  let cachedModels: HermesModelOptions | undefined;
  let cachedSetupStatus: { readonly provider_configured?: boolean } | undefined;

  const getClient = Effect.gen(function* () {
    if (client) return client;
    client = yield* runtime.connect(() => undefined);
    return client;
  });
  const rpc = <T>(method: string, params: Readonly<Record<string, unknown>> = {}) =>
    Effect.gen(function* () {
      const gateway = yield* getClient;
      return yield* Effect.tryPromise({
        try: () => gateway.request<T>(method, params),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: HERMES_DRIVER_KIND,
            method,
            detail:
              cause instanceof Error ? cause.message : `Hermes gateway request failed: ${method}`,
            cause,
          }),
      });
    });

  const getModels = lock.withPermit(
    Effect.suspend(() =>
      cachedModels
        ? Effect.succeed(cachedModels)
        : rpc<HermesModelOptions>("model.options").pipe(
            Effect.tap((models) => Effect.sync(() => (cachedModels = models))),
          ),
    ),
  );
  // Commands include profile-local quick commands and installed skills, so refresh the
  // catalog whenever provider status is refreshed instead of pinning the startup result.
  const getCommands = lock.withPermit(rpc<HermesCommandsCatalog>("commands.catalog"));
  const getSetupStatus = lock.withPermit(
    Effect.suspend(() =>
      cachedSetupStatus
        ? Effect.succeed(cachedSetupStatus)
        : rpc<{ readonly provider_configured?: boolean }>("setup.status").pipe(
            Effect.tap((status) => Effect.sync(() => (cachedSetupStatus = status))),
          ),
    ),
  );
  const generate: HermesGatewayUtility["generate"] = (input) =>
    lock.withPermit(
      rpc<{ readonly text?: string }>("llm.oneshot", {
        input: input.prompt,
        task: "t3_code",
        max_tokens: 2_048,
      }).pipe(
        Effect.map((result) => ({
          text: result.text ?? "",
          response: { stopReason: "end_turn" as const },
        })),
      ),
    );

  yield* Effect.addFinalizer(() => Effect.sync(() => client?.close()));
  return { getModels, getCommands, getSetupStatus, generate };
});
