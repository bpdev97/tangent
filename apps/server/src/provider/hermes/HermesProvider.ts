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

import { type ProviderAdapterError, ProviderAdapterRequestError } from "../Errors.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import type { HermesCommandsCatalog, HermesModelOptions } from "./HermesGatewayUtility.ts";
import { HERMES_DRIVER_KIND } from "./HermesGatewaySupport.ts";

const HERMES_PRESENTATION = {
  displayName: "Hermes",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: false,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });
const VERSION_PROBE_TIMEOUT_MS = 4_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 20_000;

export function describeHermesDiscoveryFailure(
  error: ProviderAdapterError | undefined,
  profile: string,
): {
  readonly auth: { readonly status: "unauthenticated" | "unknown" };
  readonly message: string;
} {
  const detail = error?.message ?? "";
  if (/not configured|no llm provider|unauthenticated/i.test(detail)) {
    return {
      auth: { status: "unauthenticated" },
      message: `Hermes profile '${profile}' is not ready. Configure it with \`hermes --profile ${profile} model\`, then refresh provider status.`,
    };
  }
  return {
    auth: { status: "unknown" },
    message:
      "Hermes Agent is installed but its TUI gateway did not start. Check server logs for details.",
  };
}

function modelsFromSettings(
  customModels: HermesSettings["customModels"],
  discoveredModels: ReadonlyArray<ServerProviderModel> = [],
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(discoveredModels, customModels ?? [], EMPTY_CAPABILITIES);
}

export function buildHermesModelsFromGateway(
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

export function buildHermesSlashCommandsFromGateway(
  catalog: HermesCommandsCatalog | null | undefined,
): ReadonlyArray<ServerProviderSlashCommand> {
  const commands = new Map<string, ServerProviderSlashCommand>();
  for (const [rawName, rawDescription] of catalog?.pairs ?? []) {
    const name = rawName.replace(/^\/+/, "").trim();
    if (!name || /\s/.test(name)) continue;

    const description = rawDescription.trim() || undefined;
    const key = name.toLowerCase();
    const existing = commands.get(key);
    commands.set(key, {
      name: existing?.name ?? name,
      ...(existing?.description
        ? { description: existing.description }
        : description
          ? { description }
          : {}),
    });
  }
  return [...commands.values()];
}

export const buildInitialHermesProviderSnapshot = Effect.fn("buildInitialHermesProviderSnapshot")(
  function* (settings: HermesSettings) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const models = modelsFromSettings(settings.customModels);
    if (!settings.enabled) {
      return buildServerProvider({
        presentation: HERMES_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Hermes is disabled in T3 Code settings.",
        },
      });
    }
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: `Checking Hermes profile '${settings.profile}'...`,
      },
    });
  },
);

const runVersionCommand = (settings: HermesSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const executable = settings.binaryPath || "hermes";
    const args = ["--version"];
    const resolved = yield* resolveSpawnCommand(executable, args, { env: environment });
    return yield* spawnAndCollect(
      executable,
      ChildProcess.make(resolved.command, resolved.args, {
        env: environment,
        extendEnv: true,
        shell: resolved.shell,
      }),
    );
  });

export const checkHermesProviderStatus = Effect.fn("checkHermesProviderStatus")(function* (
  settings: HermesSettings,
  environment: NodeJS.ProcessEnv,
  discoverModels: Effect.Effect<HermesModelOptions, ProviderAdapterError>,
  discoverCommands: Effect.Effect<HermesCommandsCatalog, ProviderAdapterError>,
  getSetupStatus: Effect.Effect<{ readonly provider_configured?: boolean }, ProviderAdapterError>,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = modelsFromSettings(settings.customModels);
  if (!settings.enabled) return yield* buildInitialHermesProviderSnapshot(settings);

  const versionResult = yield* runVersionCommand(settings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(versionResult.failure),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(versionResult.failure)
          ? "Hermes Agent (`hermes`) is not installed or not on PATH."
          : "Failed to execute the Hermes Agent health check.",
      },
    });
  }
  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Hermes Agent timed out while reporting its version.",
      },
    });
  }
  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Hermes Agent is installed but its version check failed.",
      },
    });
  }

  const setup = yield* getSetupStatus.pipe(
    Effect.timeoutOption(MODEL_DISCOVERY_TIMEOUT_MS),
    Effect.result,
  );
  if (
    Result.isSuccess(setup) &&
    Option.isSome(setup.success) &&
    setup.success.value.provider_configured === false
  ) {
    const diagnostic = describeHermesDiscoveryFailure(
      new ProviderAdapterRequestError({
        provider: HERMES_DRIVER_KIND,
        method: "setup.status",
        detail: "No LLM provider configured.",
      }),
      settings.profile,
    );
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: diagnostic.auth,
        message: diagnostic.message,
      },
    });
  }

  const discovery = yield* discoverModels.pipe(
    Effect.timeoutOption(MODEL_DISCOVERY_TIMEOUT_MS),
    Effect.result,
  );
  if (Result.isFailure(discovery) || Option.isNone(discovery.success)) {
    const diagnostic = describeHermesDiscoveryFailure(
      Result.isFailure(discovery) ? discovery.failure : undefined,
      settings.profile,
    );
    return buildServerProvider({
      presentation: HERMES_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: diagnostic.auth,
        message: diagnostic.message,
      },
    });
  }
  const discovered = buildHermesModelsFromGateway(discovery.success.value);
  const commands = yield* discoverCommands.pipe(
    Effect.timeoutOption(MODEL_DISCOVERY_TIMEOUT_MS),
    Effect.result,
  );
  const slashCommands =
    Result.isSuccess(commands) && Option.isSome(commands.success)
      ? buildHermesSlashCommandsFromGateway(commands.success.value)
      : [];
  return buildServerProvider({
    presentation: HERMES_PRESENTATION,
    enabled: true,
    checkedAt,
    models: modelsFromSettings(settings.customModels, discovered),
    slashCommands,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "authenticated", label: settings.profile },
    },
  });
});
