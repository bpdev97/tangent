import {
  HermesAutomationError,
  HermesAutomationListResult,
  HermesAutomationMutationInput,
  HermesSettings,
  type HermesAutomation,
  type HermesAutomationHost,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../../processRunner.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { HERMES_DRIVER_KIND } from "./HermesGatewaySupport.ts";

const decodeHermesSettings = Schema.decodeUnknownEffect(HermesSettings);
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const COMMAND_TIMEOUT = "20 seconds";
const MAX_JOBS_FILE_BYTES = 2 * 1024 * 1024;

interface ResolvedHermesAutomationHost {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly settings: HermesSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly jobsPath: string;
}

class HermesAutomationStoreError extends Data.TaggedError("HermesAutomationStoreError")<{
  readonly message: string;
}> {}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalText(value: unknown): string | null {
  const valueText = text(value)?.trim();
  return valueText ? valueText : null;
}

function stringArray(value: unknown): ReadonlyArray<string> {
  if (typeof value === "string") {
    const item = value.trim();
    return item ? [item] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const itemText = text(item)?.trim();
    return itemText ? [itemText] : [];
  });
}

function scheduleDisplay(job: Record<string, unknown>): string {
  const explicit = optionalText(job.schedule_display);
  if (explicit) return explicit;
  if (typeof job.schedule === "string") return job.schedule;
  const schedule = record(job.schedule);
  if (!schedule) return "Unknown schedule";
  for (const key of ["display", "value", "expr", "run_at"] as const) {
    const candidate = optionalText(schedule[key]);
    if (candidate) return candidate;
  }
  return "Unknown schedule";
}

function normalizeRepeat(value: unknown): HermesAutomation["repeat"] {
  const repeat = record(value);
  const times = repeat?.times;
  const completed = repeat?.completed;
  return {
    times: typeof times === "number" && Number.isFinite(times) ? times : null,
    completed:
      typeof completed === "number" && Number.isFinite(completed) ? Math.max(0, completed) : 0,
  };
}

export function projectHermesAutomationJobs(value: unknown): ReadonlyArray<HermesAutomation> {
  if (!Array.isArray(value)) {
    throw new Error("Hermes cron store must contain an array.");
  }

  return value
    .flatMap((entry): ReadonlyArray<HermesAutomation> => {
      const job = record(entry);
      const id = optionalText(job?.id);
      if (!job || !id) return [];
      const prompt = text(job.prompt) ?? "";
      const skills = stringArray(job.skills ?? job.skill);
      const script = optionalText(job.script);
      const fallbackName = prompt || skills[0] || script || id;
      const enabled = job.enabled !== false;
      return [
        {
          id,
          name: optionalText(job.name) ?? fallbackName.slice(0, 50) ?? "Cron job",
          prompt,
          schedule: scheduleDisplay(job),
          enabled,
          state: optionalText(job.state) ?? (enabled ? "scheduled" : "paused"),
          skills,
          delivery: stringArray(job.deliver).length > 0 ? stringArray(job.deliver) : ["local"],
          repeat: normalizeRepeat(job.repeat),
          nextRunAt: optionalText(job.next_run_at),
          lastRunAt: optionalText(job.last_run_at),
          lastStatus: optionalText(job.last_status),
          script,
          noAgent: job.no_agent === true,
          workdir: optionalText(job.workdir),
        },
      ];
    })
    .toSorted((left, right) => {
      if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
      const leftNext = left.nextRunAt ?? "~";
      const rightNext = right.nextRunAt ?? "~";
      return leftNext.localeCompare(rightNext) || left.name.localeCompare(right.name);
    });
}

export function resolveHermesAutomationHome(
  input: {
    readonly profile: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly platform: NodeJS.Platform;
  },
  path: Path.Path,
): string {
  const configuredHome = input.environment.HERMES_HOME?.trim();
  const defaultRoot =
    input.platform === "win32"
      ? path.join(
          input.environment.LOCALAPPDATA?.trim() ||
            path.join(input.environment.USERPROFILE?.trim() || path.sep, "AppData", "Local"),
          "hermes",
        )
      : path.join(input.environment.HOME?.trim() || path.sep, ".hermes");
  const configuredPath = configuredHome ? path.resolve(configuredHome) : null;
  const root =
    configuredPath && path.basename(path.dirname(configuredPath)) === "profiles"
      ? path.dirname(path.dirname(configuredPath))
      : (configuredPath ?? defaultRoot);
  return input.profile.toLowerCase() === "default"
    ? root
    : path.join(root, "profiles", input.profile.toLowerCase());
}

function appendOptionalFlag(args: string[], flag: string, value: string | undefined): void {
  if (value !== undefined) args.push(flag, value);
}

function appendRepeat(args: string[], repeat: number | undefined): void {
  if (repeat === undefined) return;
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error("Repeat must be a positive integer.");
  }
  args.push("--repeat", String(repeat));
}

export function buildHermesAutomationArgs(input: HermesAutomationMutationInput): string[] {
  if (input.action === "create") {
    const args = ["cron", "create", input.schedule];
    if (input.prompt) args.push(input.prompt);
    appendOptionalFlag(args, "--name", input.name);
    appendOptionalFlag(args, "--deliver", input.delivery);
    appendRepeat(args, input.repeat);
    for (const skill of input.skills ?? []) args.push("--skill", skill);
    appendOptionalFlag(args, "--script", input.script);
    if (input.noAgent) args.push("--no-agent");
    appendOptionalFlag(args, "--workdir", input.workdir);
    return args;
  }

  if (input.action === "update") {
    const args = ["cron", "edit", input.automationId];
    appendOptionalFlag(args, "--schedule", input.schedule);
    appendOptionalFlag(args, "--prompt", input.prompt);
    appendOptionalFlag(args, "--name", input.name);
    appendOptionalFlag(args, "--deliver", input.delivery);
    appendRepeat(args, input.repeat);
    if (input.skills !== undefined) {
      if (input.skills.length === 0) args.push("--clear-skills");
      else for (const skill of input.skills) args.push("--skill", skill);
    }
    appendOptionalFlag(args, "--script", input.script);
    if (input.noAgent !== undefined) args.push(input.noAgent ? "--no-agent" : "--agent");
    appendOptionalFlag(args, "--workdir", input.workdir);
    return args;
  }

  return ["cron", input.action, input.automationId];
}

function operationError(input: {
  readonly operation: HermesAutomationError["operation"];
  readonly instanceId?: ProviderInstanceId;
  readonly message: string;
}): HermesAutomationError {
  return new HermesAutomationError(input);
}

export class HermesAutomationManager extends Context.Service<
  HermesAutomationManager,
  {
    readonly list: Effect.Effect<HermesAutomationListResult, HermesAutomationError>;
    readonly mutate: (
      input: HermesAutomationMutationInput,
    ) => Effect.Effect<HermesAutomationListResult, HermesAutomationError>;
  }
>()("t3/provider/hermes/HermesAutomationManager") {}

export const make = Effect.fn("HermesAutomationManager.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const baseEnvironment = yield* HostProcessEnvironment;
  const runner = yield* ProcessRunner.ProcessRunner;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const resolveHosts = Effect.fn("HermesAutomationManager.resolveHosts")(function* () {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(() =>
        operationError({ operation: "list", message: "Could not read Hermes host settings." }),
      ),
    );
    return yield* Effect.forEach(
      Object.entries(settings.providerInstances),
      ([rawInstanceId, instance]): Effect.Effect<ResolvedHermesAutomationHost | null> => {
        if (instance.driver !== HERMES_DRIVER_KIND || instance.enabled === false) {
          return Effect.succeed(null);
        }
        return decodeHermesSettings({ ...record(instance.config), enabled: true }).pipe(
          Effect.map((hermesSettings) => {
            const environment = mergeProviderInstanceEnvironment(
              instance.environment,
              baseEnvironment,
            );
            const home = resolveHermesAutomationHome(
              {
                profile: hermesSettings.profile,
                environment,
                platform,
              },
              path,
            );
            return {
              instanceId: rawInstanceId as ProviderInstanceId,
              displayName: instance.displayName ?? `Hermes (${hermesSettings.profile})`,
              settings: hermesSettings,
              environment,
              jobsPath: path.join(home, "cron", "jobs.json"),
            } satisfies ResolvedHermesAutomationHost;
          }),
          Effect.orElseSucceed(() => null),
        );
      },
      { concurrency: 4 },
    ).pipe(Effect.map((hosts) => hosts.filter((host) => host !== null)));
  });

  const readJobs = Effect.fn("HermesAutomationManager.readJobs")(function* (
    host: ResolvedHermesAutomationHost,
  ) {
    if (!(yield* fs.exists(host.jobsPath).pipe(Effect.orElseSucceed(() => false)))) return [];
    const stat = yield* fs.stat(host.jobsPath).pipe(
      Effect.mapError(
        () =>
          new HermesAutomationStoreError({
            message: "Could not inspect the Hermes cron store.",
          }),
      ),
    );
    if (Number(stat.size) > MAX_JOBS_FILE_BYTES) {
      return yield* new HermesAutomationStoreError({
        message: "Hermes cron store exceeds the supported size.",
      });
    }
    const contents = yield* fs
      .readFileString(host.jobsPath)
      .pipe(
        Effect.mapError(
          () =>
            new HermesAutomationStoreError({ message: "Could not read the Hermes cron store." }),
        ),
      );
    const parsed = yield* decodeUnknownJson(contents).pipe(
      Effect.mapError(
        () =>
          new HermesAutomationStoreError({
            message: "Hermes cron store contains invalid JSON.",
          }),
      ),
    );
    return yield* Effect.try({
      try: () => projectHermesAutomationJobs(parsed),
      catch: () =>
        new HermesAutomationStoreError({
          message: "Hermes cron store has an unsupported structure.",
        }),
    });
  });

  const runHermes = Effect.fn("HermesAutomationManager.runHermes")(function* (
    host: ResolvedHermesAutomationHost,
    args: ReadonlyArray<string>,
    operation: HermesAutomationError["operation"],
  ) {
    const output = yield* runner
      .run({
        command: host.settings.binaryPath || "hermes",
        args: ["--profile", host.settings.profile, ...args],
        env: host.environment,
        timeout: COMMAND_TIMEOUT,
        maxOutputBytes: 256 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError(() =>
          operationError({
            operation,
            instanceId: host.instanceId,
            message: `Could not run Hermes automation ${operation} on ${host.displayName}.`,
          }),
        ),
      );
    if (output.code !== 0 || output.timedOut) {
      return yield* operationError({
        operation,
        instanceId: host.instanceId,
        message: `Hermes automation ${operation} failed on ${host.displayName}.`,
      });
    }
  });

  const projectHost = Effect.fn("HermesAutomationManager.projectHost")(function* (
    host: ResolvedHermesAutomationHost,
  ): Effect.fn.Return<HermesAutomationHost> {
    const probe = yield* Effect.result(runHermes(host, ["cron", "list", "--all"], "list"));
    if (probe._tag === "Failure") {
      return {
        instanceId: host.instanceId,
        displayName: host.displayName,
        profile: host.settings.profile,
        status: "unavailable",
        statusMessage: "Hermes cron management is unavailable on this host.",
        automations: [],
      };
    }
    const jobs = yield* readJobs(host).pipe(Effect.result);
    if (jobs._tag === "Failure") {
      return {
        instanceId: host.instanceId,
        displayName: host.displayName,
        profile: host.settings.profile,
        status: "unavailable",
        statusMessage: jobs.failure.message,
        automations: [],
      };
    }
    return {
      instanceId: host.instanceId,
      displayName: host.displayName,
      profile: host.settings.profile,
      status: "available",
      statusMessage: null,
      automations: jobs.success,
    };
  });

  const list: Effect.Effect<HermesAutomationListResult, HermesAutomationError> =
    resolveHosts().pipe(
      Effect.flatMap((hosts) => Effect.forEach(hosts, projectHost, { concurrency: 4 })),
      Effect.map((hosts) => ({ hosts })),
    );

  const mutate = Effect.fn("HermesAutomationManager.mutate")(function* (
    input: HermesAutomationMutationInput,
  ) {
    const hosts = yield* resolveHosts();
    const host = hosts.find((candidate) => candidate.instanceId === input.instanceId);
    if (!host) {
      return yield* operationError({
        operation: input.action,
        instanceId: input.instanceId,
        message: "The selected Hermes host is no longer configured.",
      });
    }
    const args = yield* Effect.try({
      try: () => buildHermesAutomationArgs(input),
      catch: () =>
        operationError({
          operation: input.action,
          instanceId: input.instanceId,
          message: "The Hermes automation request is invalid.",
        }),
    });
    yield* runHermes(host, args, input.action);
    return yield* list;
  });

  return HermesAutomationManager.of({ list, mutate });
});

export const layer = Layer.effect(HermesAutomationManager, make()).pipe(
  Layer.provide(ProcessRunner.layer),
);
