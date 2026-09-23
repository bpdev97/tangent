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
import * as HostProcess from "@t3tools/shared/HostProcess";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import { ServerConfig } from "../../config.ts";
import { makeHermesAdapterV2 } from "../../orchestration-v2/Adapters/HermesAdapterV2.ts";
import { IdAllocatorV2 } from "@t3tools/provider-core/server/IdAllocator";
import { ProviderContinuationRequests } from "@t3tools/provider-core/server/ProviderContinuationRequests";
import { ProviderDriverError } from "../Errors.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  makeCachedProviderMaintenanceResolution,
} from "@t3tools/provider-core/server/maintenanceResolver";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import type { ServerProviderDraft } from "@t3tools/provider-core/server/snapshotProbe";
import { hermesUsageReader } from "../../usage/hermesUsageReader.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";
import { HermesGatewayFleet, makeHermesGatewayRuntime } from "./HermesGatewayRuntime.ts";
import { HERMES_DRIVER_KIND } from "./HermesGatewaySupport.ts";
import { makeHermesGatewayUtility } from "./HermesGatewayUtility.ts";
import {
  fetchHermesLatestRelease,
  hermesMaintenanceCapabilities,
  readHermesInfoOrNull,
} from "./HermesMaintenance.ts";
import { buildInitialHermesProviderSnapshot, checkHermesProviderStatus } from "./HermesProvider.ts";
import { hermesProfileHome, installHermesT3Plugin, makeHermesT3Bridge } from "./HermesT3Tools.ts";
import { makeHermesTextGeneration } from "./HermesTextGeneration.ts";

const decodeHermesSettings = Schema.decodeSync(HermesSettings);
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export type HermesDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | IdAllocatorV2
  | McpProviderSessions.McpProviderSessions
  | Path.Path
  | ProviderHost.ProviderHost
  | ProviderLatestVersions.ProviderLatestVersions
  | ServerConfig;

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

export const HermesDriver: ProviderDriver<
  HermesSettings,
  HermesDriverEnv,
  FileSystem.FileSystem | Path.Path
> = {
  driverKind: HERMES_DRIVER_KIND,
  // Every Hermes instance names its profile, so there is no implicit default one.
  metadata: { displayName: "Hermes", supportsMultipleInstances: true, hasDefaultInstance: false },
  configSchema: HermesSettings,
  defaultConfig: () => decodeHermesSettings({}),
  usage: hermesUsageReader,
  create: Effect.fn("HermesDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const httpClient = yield* HttpClient.HttpClient;
    const latestVersions = yield* ProviderLatestVersions.ProviderLatestVersions;
    const fleet = yield* HermesGatewayFleet;
    const processEnv = yield* mergeProviderInstanceEnvironment(
      environment,
      yield* HostProcess.Environment,
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

    const serverConfig = yield* ServerConfig;
    const path = yield* Path.Path;
    const profileHome = yield* hermesProfileHome(processEnv, effectiveConfig.profile);
    if (effectiveConfig.enabled) {
      yield* installHermesT3Plugin(processEnv, effectiveConfig.profile);
    }
    const t3Bridge = yield* makeHermesT3Bridge(
      path.join(serverConfig.stateDir, "hermes-t3-code", instanceId),
      profileHome === undefined ? undefined : path.join(profileHome, "config.yaml"),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: HERMES_DRIVER_KIND,
            instanceId,
            detail: "Failed to prepare the Hermes t3-code tool bridge.",
            cause,
          }),
      ),
    );
    const runtime = yield* makeHermesGatewayRuntime({
      binaryPath: effectiveConfig.binaryPath,
      profile: effectiveConfig.profile,
      environment: processEnv,
      t3Bridge,
    });
    const utility = yield* makeHermesGatewayUtility(runtime);
    const orchestrationAdapter = makeHermesAdapterV2({
      instanceId,
      runtime,
      homeDirectory: processEnv.HOME ?? processEnv.USERPROFILE,
      idAllocator: yield* IdAllocatorV2,
      serverConfig,
      t3Bridge,
      // Shared with the continuation worker by ProviderOrchestrationAdapterInfrastructure.
      continuationRequests: yield* ProviderContinuationRequests,
    });

    const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
      Effect.gen(function* () {
        const info = effectiveConfig.enabled ? yield* readHermesInfoOrNull(utility.readInfo) : null;
        const latest = yield* fetchHermesLatestRelease.pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
        );
        return hermesMaintenanceCapabilities({
          info,
          binaryPath: effectiveConfig.binaryPath,
          environment: processEnv,
          latestVersion: latest.version,
          latestTag: latest.tag,
          fleet,
        });
      }),
    );

    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<HermesSettings>>({
      resolveMaintenance,
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: (settings) =>
        buildInitialHermesProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
      checkProvider: checkHermesProviderStatus(effectiveConfig, processEnv, utility, {
        loaded: t3Bridge.pluginLoaded,
        restartIfConfigChanged: Effect.gen(function* () {
          if (!(yield* t3Bridge.profileConfigChanged)) return false;
          // Counts running subagents too; stopping the gateway would end them.
          if ((yield* runtime.activeTurns) > 0) return false;
          yield* runtime.stop;
          return true;
        }),
      }).pipe(
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
          Effect.provideService(ProviderLatestVersions.ProviderLatestVersions, latestVersions),
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
