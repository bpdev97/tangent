/**
 * HermesDriver — provider driver for Hermes Agent (Tangent FORK-HERMES-001).
 *
 * One instance is one explicit Hermes profile with one supervised gateway
 * process, shared by the v2 adapter, model and command discovery, readiness,
 * text generation, and the updater's self-description probe.
 *
 * @module provider/hermes/HermesDriver
 */
import { HermesSettings, type ServerProvider } from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { makeHermesAdapterV2 } from "../../orchestration-v2/Adapters/HermesAdapterV2.ts";
import { IdAllocatorV2 } from "../../orchestration-v2/IdAllocator.ts";
import { ProviderContinuationRequests } from "../../orchestration-v2/ProviderContinuationRequests.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
  ProviderVersionCache,
} from "../providerMaintenance.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";
import { HermesGatewayFleet, makeHermesGatewayRuntime } from "./HermesGatewayRuntime.ts";
import { HERMES_DRIVER_KIND } from "./HermesGatewaySupport.ts";
import { makeHermesGatewayUtility } from "./HermesGatewayUtility.ts";
import {
  fetchHermesLatestVersion,
  hermesMaintenanceCapabilities,
  readHermesInfoOrNull,
} from "./HermesMaintenance.ts";
import { buildInitialHermesProviderSnapshot, checkHermesProviderStatus } from "./HermesProvider.ts";
import { makeHermesTextGeneration } from "./HermesTextGeneration.ts";

const decodeHermesSettings = Schema.decodeSync(HermesSettings);
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export type HermesDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | HttpClient.HttpClient
  | IdAllocatorV2
  | ServerConfig
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: HERMES_DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const HermesDriver: ProviderDriver<HermesSettings, HermesDriverEnv> = {
  driverKind: HERMES_DRIVER_KIND,
  metadata: { displayName: "Hermes", supportsMultipleInstances: true },
  configSchema: HermesSettings,
  defaultConfig: () => decodeHermesSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const httpClient = yield* HttpClient.HttpClient;
      const versionCache = yield* ProviderVersionCache;
      const fleet = yield* HermesGatewayFleet;
      const serverSettings = yield* ServerSettingsService;
      const processEnv = mergeProviderInstanceEnvironment(
        environment,
        yield* HostProcessEnvironment,
      );
      const effectiveConfig = { ...config, enabled } satisfies HermesSettings;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: HERMES_DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });

      const runtime = yield* makeHermesGatewayRuntime({
        binaryPath: effectiveConfig.binaryPath,
        profile: effectiveConfig.profile,
        environment: processEnv,
      });
      const utility = yield* makeHermesGatewayUtility(runtime);
      const orchestrationAdapter = makeHermesAdapterV2({
        instanceId,
        runtime,
        homeDirectory: processEnv.HOME ?? processEnv.USERPROFILE,
        idAllocator: yield* IdAllocatorV2,
        serverConfig: yield* ServerConfig,
        // Shared with the continuation worker by ProviderOrchestrationAdapterInfrastructure.
        continuationRequests: yield* ProviderContinuationRequests,
      });

      const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
        Effect.gen(function* () {
          const info = effectiveConfig.enabled
            ? yield* readHermesInfoOrNull(utility.readInfo)
            : null;
          const latestVersion = yield* fetchHermesLatestVersion.pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.provideService(ProviderVersionCache, versionCache),
          );
          return hermesMaintenanceCapabilities({
            info,
            binaryPath: effectiveConfig.binaryPath,
            environment: processEnv,
            latestVersion,
            fleet,
          });
        }),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<HermesSettings>>({
        resolveMaintenance,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialHermesProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: checkHermesProviderStatus(effectiveConfig, processEnv, utility).pipe(
          Effect.map(stampIdentity),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
        enrichSnapshot: ({ settings, snapshot: current, publishSnapshot }) =>
          // A fresh read: the check just re-probed the gateway's version and command.
          resolveMaintenance({ fresh: true }).pipe(
            Effect.flatMap((capabilities) =>
              enrichProviderSnapshotWithVersionAdvisory(current, capabilities, {
                enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
              }),
            ),
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.flatMap(publishSnapshot),
            Effect.catchCause((cause) =>
              Effect.logWarning("Hermes version advisory failed", {
                errorTag: causeErrorTag(cause),
              }),
            ),
          ),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: HERMES_DRIVER_KIND,
              instanceId,
              detail: "Failed to build Hermes snapshot.",
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: HERMES_DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        orchestrationAdapter,
        textGeneration: makeHermesTextGeneration(utility),
      } satisfies ProviderInstance;
    }),
};
