/**
 * Provider snapshot for a Hermes instance: install and version probe, profile
 * readiness, gateway contract, model and slash-command discovery.
 *
 * Version and contract come from the running gateway; `hermes --version` is
 * the fallback when the gateway cannot describe itself (for example a profile
 * with no model configured). A gateway below the minimum contract is reported
 * as incompatible; its version advisory still offers the update action.
 *
 * @module provider/hermes/HermesProvider
 */
import {
  type HermesSettings,
  type ModelCapabilities,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import type { HermesGatewayInfo } from "./HermesGatewayRuntime.ts";
import { HERMES_DEFAULT_MODEL_SLUG, HERMES_MIN_GATEWAY_CONTRACT } from "./HermesGatewaySupport.ts";
import type {
  HermesCommandsCatalog,
  HermesGatewayUtility,
  HermesModelOptions,
} from "./HermesGatewayUtility.ts";
import { readHermesInfoOrNull } from "./HermesMaintenance.ts";

const HERMES_PRESENTATION = {
  displayName: "Hermes",
  showInteractionModeToggle: false,
  supportedRuntimeModes: ["approval-required", "auto-accept-edits", "full-access"],
  reportsContextWindow: true,
  requiresNewThreadForModelChange: false,
  supportsConversationRollback: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const DISCOVERY_TIMEOUT_MS = 30_000;

const DEFAULT_MODEL: ServerProviderModel = {
  slug: HERMES_DEFAULT_MODEL_SLUG,
  name: "Hermes default",
  isCustom: false,
  capabilities: EMPTY_CAPABILITIES,
};

function models(
  settings: HermesSettings,
  discovered: ReadonlyArray<ServerProviderModel> = [],
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    [DEFAULT_MODEL, ...discovered],
    settings.customModels ?? [],
    EMPTY_CAPABILITIES,
  );
}

/** Model IDs are `<provider>:<model>` so Hermes never guesses the provider. */
function buildHermesModelsFromGateway(
  options: HermesModelOptions | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  return (options?.providers ?? []).flatMap((provider) =>
    provider.authenticated === false
      ? []
      : (provider.models ?? []).flatMap((model) => {
          const cleanModel = model.trim();
          if (!cleanModel) return [];
          const slug = `${provider.slug}:${cleanModel}`;
          if (seen.has(slug)) return [];
          seen.add(slug);
          return [
            {
              slug,
              name: cleanModel,
              subProvider: provider.name.trim() || provider.slug,
              isCustom: false,
              capabilities: EMPTY_CAPABILITIES,
            } satisfies ServerProviderModel,
          ];
        }),
  );
}

function buildHermesSlashCommandsFromGateway(
  catalog: HermesCommandsCatalog | null | undefined,
): ReadonlyArray<ServerProviderSlashCommand> {
  const commands = new Map<string, ServerProviderSlashCommand>();
  for (const [rawName, rawDescription] of catalog?.pairs ?? []) {
    const name = rawName.replace(/^\/+/u, "").trim();
    if (!name || /\s/u.test(name)) continue;
    const key = name.toLowerCase();
    if (commands.has(key)) continue;
    const description = rawDescription.trim();
    commands.set(key, { name, ...(description ? { description } : {}) });
  }
  return [...commands.values()];
}

export const buildInitialHermesProviderSnapshot = Effect.fn("buildInitialHermesProviderSnapshot")(
  function* (settings: HermesSettings) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: models(settings),
      probe: {
        installed: settings.enabled,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? `Checking Hermes profile '${settings.profile}'...`
          : "Hermes is disabled in T3 Code settings.",
      },
    });
  },
);

const runVersionCommand = (settings: HermesSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const executable = settings.binaryPath || "hermes";
    const resolved = yield* resolveSpawnCommand(executable, ["--version"], { env: environment });
    return yield* spawnAndCollect(
      executable,
      ChildProcess.make(resolved.command, resolved.args, {
        env: environment,
        shell: resolved.shell,
      }),
    );
  });

function hermesContractMessage(info: HermesGatewayInfo | null): string | undefined {
  if (info?.contract == null || info.contract >= HERMES_MIN_GATEWAY_CONTRACT) return undefined;
  return `Hermes ${info.version ?? "on this host"} uses gateway contract ${info.contract}; T3 Code needs contract ${HERMES_MIN_GATEWAY_CONTRACT} or newer. Update Hermes.`;
}

export const checkHermesProviderStatus = Effect.fn("checkHermesProviderStatus")(function* (
  settings: HermesSettings,
  environment: NodeJS.ProcessEnv,
  utility: HermesGatewayUtility,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  if (!settings.enabled) return yield* buildInitialHermesProviderSnapshot(settings);
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = models(settings);
  const snapshot = (
    probe: Parameters<typeof buildServerProvider>[0]["probe"],
    extra: {
      readonly models?: ReadonlyArray<ServerProviderModel>;
      readonly slashCommands?: ReadonlyArray<ServerProviderSlashCommand>;
    } = {},
  ) =>
    buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: extra.models ?? fallbackModels,
      ...(extra.slashCommands ? { slashCommands: extra.slashCommands } : {}),
      probe,
    });

  const versionResult = yield* runVersionCommand(settings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    const missing = isCommandMissingCause(versionResult.failure);
    return snapshot({
      installed: !missing,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: missing
        ? "Hermes Agent (`hermes`) is not installed or not on PATH."
        : "Failed to run the Hermes Agent health check.",
    });
  }
  if (Option.isNone(versionResult.success)) {
    return snapshot({
      installed: true,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: "Hermes Agent timed out while reporting its version.",
    });
  }
  const output = versionResult.success.value;
  const cliVersion = parseGenericCliVersion(`${output.stdout}\n${output.stderr}`);
  if (output.code !== 0) {
    return snapshot({
      installed: true,
      version: cliVersion,
      status: "error",
      auth: { status: "unknown" },
      message: "Hermes Agent is installed but its version check failed.",
    });
  }

  const setup = yield* utility.getSetupStatus.pipe(
    Effect.timeoutOption(DISCOVERY_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(setup) || Option.isNone(setup.success)) {
    return snapshot({
      installed: true,
      version: cliVersion,
      status: "error",
      auth: { status: "unknown" },
      message: "Hermes Agent is installed but its gateway did not start. Check server logs.",
    });
  }
  const info = yield* readHermesInfoOrNull(utility.readInfo);
  const version = info?.version ?? cliVersion;
  const incompatible = hermesContractMessage(info);
  if (incompatible) {
    return snapshot({
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      message: incompatible,
    });
  }
  if (setup.success.value.provider_configured === false) {
    return snapshot({
      installed: true,
      version,
      status: "error",
      auth: { status: "unauthenticated" },
      message: `Hermes profile '${settings.profile}' has no model configured. Run \`hermes --profile ${settings.profile} model\` in a terminal, then refresh.`,
    });
  }

  const discovery = yield* utility.getModels.pipe(
    Effect.timeoutOption(DISCOVERY_TIMEOUT_MS),
    Effect.result,
  );
  const commands = yield* utility.getCommands.pipe(
    Effect.timeoutOption(DISCOVERY_TIMEOUT_MS),
    Effect.result,
  );
  const discovered =
    Result.isSuccess(discovery) && Option.isSome(discovery.success)
      ? buildHermesModelsFromGateway(discovery.success.value)
      : [];
  const slashCommands =
    Result.isSuccess(commands) && Option.isSome(commands.success)
      ? buildHermesSlashCommandsFromGateway(commands.success.value)
      : [];
  return snapshot(
    {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated", label: settings.profile },
    },
    { models: models(settings, discovered), slashCommands },
  );
});
