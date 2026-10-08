/**
 * Tangent's `t3-code` tools for Hermes threads.
 *
 * Every other provider attaches the `t3-code` MCP server once per session,
 * with that thread's credential. Hermes cannot: one gateway serves every
 * thread of an instance and connects to MCP servers once per process. So a
 * Tangent-owned Hermes plugin registers the tools natively, and each call
 * looks up the calling Hermes session in a private directory to find its
 * thread's endpoint and credential. Hermes passes the durable session key to
 * plugin tool handlers, which is the key the adapter stores per thread.
 *
 * The directory holds the tool list, written before the gateway starts
 * (Hermes fixes a session's tool list when its agent is built), and one file
 * per attached session. Those files are owner-only, but every thread of the
 * instance runs as the same user in the same gateway, so one thread's shell
 * could read another's. The boundary is the OS user, as it is for the
 * credentials other providers hold in their own process.
 *
 * Hermes loads a plugin only when the profile's config lists it under
 * `plugins.enabled`. Tangent writes the plugin files and never edits that
 * config; the plugin reports back when it loads so the provider status can
 * say how to turn it on.
 *
 * @module provider/hermes/HermesT3Tools
 */
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool } from "effect/ai";

import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  T3_CODE_BROWSER_TOOL_INSTRUCTIONS,
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
} from "../T3OrchestrationInstructions.ts";
import {
  HERMES_T3_INSTRUCTIONS_TAG,
  HERMES_T3_LOADED_FILE,
  HERMES_T3_PLUGIN_MANIFEST,
  HERMES_T3_PLUGIN_NAME,
  HERMES_T3_PLUGIN_SOURCE,
  HERMES_T3_SESSIONS_DIR,
  HERMES_T3_TOOLS_FILE,
  HERMES_T3_TOOL_PREFIX,
} from "./HermesT3PluginSource.ts";

const SESSION_KEY = /^[A-Za-z0-9_.-]+$/u;
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Named profiles are a single lowercase path component under `profiles/`. */
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/**
 * Tangent's instructions are written for the `t3-code` MCP server. Hermes
 * reaches the same tools under a prefix, behind its tool search, and already
 * has a `delegate_task` of its own.
 */
const HERMES_T3_PREFACE = `These instructions come from Tangent (T3 Code), the app this conversation runs in, not from the user.

Tangent's tools are registered in Hermes with the prefix \`${HERMES_T3_TOOL_PREFIX}\`, for example \`${HERMES_T3_TOOL_PREFIX}html_render\`. Wherever the text below names a \`t3-code\` tool, call it under that prefix, through \`tool_search\` and \`tool_call\` when it is not listed directly.

Hermes's own \`delegate_task\` starts a Hermes subagent. \`${HERMES_T3_TOOL_PREFIX}delegate_task\` is a different tool: it hands work to another provider or model through Tangent. Use Hermes's own unless the user asks for another provider or model.`;

/** What a Hermes thread is told once, with the first message Tangent sends it. */
function hermesT3Instructions(browserToolsAvailable: boolean): string {
  return [
    `<${HERMES_T3_INSTRUCTIONS_TAG}>`,
    HERMES_T3_PREFACE,
    ...(browserToolsAvailable ? [T3_CODE_BROWSER_TOOL_INSTRUCTIONS.trim()] : []),
    T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim(),
    `</${HERMES_T3_INSTRUCTIONS_TAG}>`,
  ].join("\n\n");
}

export interface HermesT3ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

/** What the tool list depends on beyond the code: settings read once per server start. */
export interface HermesT3ToolOptions {
  /**
   * Tangent(FORK-WALK-001): this environment's review policy, which
   * `walkthrough_publish` carries in its description. Absent means the
   * shipped default.
   */
  readonly walkthroughPolicy?: string | undefined;
}

/**
 * One entry per directory under `mcp/toolkits`, each the toolkit holding every
 * tool that directory defines. Imported lazily: the toolkit modules reach the
 * orchestrator, which reaches this provider.
 */
export const HERMES_T3_TOOLKITS = {
  attachment: async () =>
    (await import("../../mcp/toolkits/attachment/tools.ts")).AttachmentToolkit,
  device: async () => (await import("../../mcp/toolkits/device/tools.ts")).DeviceToolkit,
  environment: async () =>
    (await import("../../mcp/toolkits/environment/tools.ts")).EnvironmentToolkit,
  html: async () => (await import("../../mcp/toolkits/html/tools.ts")).HtmlToolkit,
  orchestrator: async () =>
    (await import("../../mcp/toolkits/orchestrator/tools.ts")).OrchestratorToolkit,
  preview: async () => (await import("../../mcp/toolkits/preview/tools.ts")).PreviewToolkit,
  previewControls: async () =>
    (await import("../../mcp/toolkits/previewControls/tools.ts")).PreviewControlsToolkit,
  project: async () => (await import("../../mcp/toolkits/project/tools.ts")).ProjectToolkit,
  pullRequests: async () =>
    (await import("../../mcp/toolkits/pullRequests/tools.ts")).PullRequestsToolkit,
  thread: async () => (await import("../../mcp/toolkits/thread/tools.ts")).ThreadToolkit,
  // Tangent(FORK-WALK-001): built from the environment's policy, as `McpHttpServer` builds it.
  walkthrough: async (options?: HermesT3ToolOptions) => {
    const tools = await import("../../mcp/toolkits/walkthrough/tools.ts");
    return options?.walkthroughPolicy === undefined
      ? tools.WalkthroughToolkit
      : tools.makeWalkthroughToolkit(options.walkthroughPolicy);
  },
  worktree: async () => (await import("../../mcp/toolkits/worktree/tools.ts")).WorktreeToolkit,
};

/** Every tool the `t3-code` MCP server registers (`McpHttpServer.layer`). */
export const makeHermesT3ToolManifest = (options?: HermesT3ToolOptions) =>
  Effect.promise(async () => {
    const toolkits = await Promise.all(
      Object.values(HERMES_T3_TOOLKITS).map((load) => load(options)),
    );
    return toolkits
      .flatMap((toolkit) => Object.values(toolkit.tools) as ReadonlyArray<Tool.Any>)
      .map((tool): HermesT3ToolDefinition => ({
        name: tool.name,
        description: Tool.getDescription(tool) ?? "",
        inputSchema: Tool.getJsonSchema(tool),
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  });

/** The tool list with every setting at its default. */
export const hermesT3ToolManifest = makeHermesT3ToolManifest();

export interface HermesT3Bridge {
  /** Handed to the gateway process; the plugin reads it and nothing else does. */
  readonly directory: string;
  /** Forget what the previous gateway process reported. Run before each start. */
  readonly gatewayStarting: Effect.Effect<void>;
  /** Note the profile config the new gateway process read. Run once it is up. */
  readonly gatewayReady: Effect.Effect<void>;
  /** Whether the gateway started last loaded the plugin, which means the profile enables it. */
  readonly pluginLoaded: Effect.Effect<boolean>;
  /**
   * Whether the profile's config changed since the running gateway read it.
   * Hermes reads `plugins.enabled` once per process, so turning the plugin on
   * or off only takes effect in a new one.
   */
  readonly profileConfigChanged: Effect.Effect<boolean>;
  /**
   * Point a Hermes session at its thread's `t3-code` credential and
   * instructions. Safe to repeat: the credential can rotate while a session
   * stays open.
   */
  readonly attach: (sessionKey: string, threadId: ThreadId) => Effect.Effect<void>;
  readonly detach: (sessionKey: string) => Effect.Effect<void>;
}

/**
 * Create the directory and write the tool list. Call before the gateway
 * starts. Credentials are written owner-only, like the server's secret store.
 */
export const makeHermesT3Bridge = Effect.fn("makeHermesT3Bridge")(function* (
  directory: string,
  /** The profile's `config.yaml`, when its home is known. Only ever read for its timestamp. */
  profileConfigPath?: string,
  toolOptions?: HermesT3ToolOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // What the running gateway read: the config's modification time, or `null` when there was no
  // file. `undefined` until a gateway is up, because only a change it did not see counts.
  let configRead: number | null | undefined;
  const configModifiedAt =
    profileConfigPath === undefined
      ? Effect.succeed(null)
      : fs.stat(profileConfigPath).pipe(
          Effect.map((info) => Option.getOrNull(info.mtime)?.getTime() ?? null),
          Effect.orElseSucceed(() => null),
        );
  const sessionsDirectory = path.join(directory, HERMES_T3_SESSIONS_DIR);
  // A previous server's credentials are dead; never leave them readable.
  yield* fs.remove(sessionsDirectory, { recursive: true, force: true });
  yield* fs.makeDirectory(sessionsDirectory, { recursive: true });
  yield* fs.chmod(directory, 0o700);
  yield* fs.chmod(sessionsDirectory, 0o700);
  yield* fs.writeFileString(
    path.join(directory, HERMES_T3_TOOLS_FILE),
    encodeJson(yield* makeHermesT3ToolManifest(toolOptions)),
  );

  const loadedFile = path.join(directory, HERMES_T3_LOADED_FILE);
  yield* fs.remove(loadedFile, { force: true });
  const sessionFile = (sessionKey: string) => path.join(sessionsDirectory, `${sessionKey}.json`);
  const quietly = <E>(operation: string, effect: Effect.Effect<void, E>) =>
    effect.pipe(
      Effect.catch(() =>
        Effect.logWarning("Hermes t3-code bridge file update failed", { operation }),
      ),
    );

  return {
    directory,
    gatewayStarting: Effect.sync(() => {
      configRead = undefined;
    }).pipe(Effect.andThen(quietly("gatewayStarting", fs.remove(loadedFile, { force: true })))),
    // Taken after startup, so anything Hermes writes to its own config while starting is not a change.
    gatewayReady: configModifiedAt.pipe(
      Effect.map((modifiedAt) => {
        configRead = modifiedAt;
      }),
    ),
    pluginLoaded: fs.exists(loadedFile).pipe(Effect.orElseSucceed(() => false)),
    // Created, edited, and deleted all count.
    profileConfigChanged:
      profileConfigPath === undefined
        ? Effect.succeed(false)
        : configModifiedAt.pipe(
            Effect.map((modifiedAt) => configRead !== undefined && modifiedAt !== configRead),
          ),
    attach: (sessionKey, threadId) => {
      const session = McpProviderSession.readMcpProviderSession(threadId);
      if (session === undefined || !SESSION_KEY.test(sessionKey)) return Effect.void;
      const target = sessionFile(sessionKey);
      const staged = `${target}.tmp`;
      return quietly(
        "attach",
        fs
          .writeFileString(
            staged,
            encodeJson({
              endpoint: session.endpoint,
              authorization: session.authorizationHeader,
              instructions: hermesT3Instructions(session.browserToolsAvailable),
            }),
            { mode: 0o600 },
          )
          .pipe(Effect.andThen(fs.rename(staged, target))),
      );
    },
    detach: (sessionKey) =>
      SESSION_KEY.test(sessionKey)
        ? quietly("detach", fs.remove(sessionFile(sessionKey), { force: true }))
        : Effect.void,
  } satisfies HermesT3Bridge;
});

/**
 * The directory `hermes --profile <profile>` uses as `HERMES_HOME`, by
 * Hermes's own rule (`resolve_profile_env`): the root is an exported
 * `HERMES_HOME` (or its grandparent when that names a profile), else
 * `~/.hermes`, and named profiles live under `profiles/`. `undefined` when it
 * cannot be worked out.
 */
export const hermesProfileHome = Effect.fn("hermesProfileHome")(function* (
  environment: NodeJS.ProcessEnv,
  profile: string,
) {
  const path = yield* Path.Path;
  const configured = environment.HERMES_HOME?.trim();
  const home = environment.HOME?.trim();
  const root = configured
    ? path.basename(path.dirname(configured)) === "profiles"
      ? path.dirname(path.dirname(configured))
      : configured
    : home
      ? path.join(home, ".hermes")
      : undefined;
  if (root === undefined || !path.isAbsolute(root)) return undefined;
  const name = profile.trim().toLowerCase();
  if (name === "" || name === "default") return root;
  return PROFILE_ID.test(name) ? path.join(root, "profiles", name) : undefined;
});

/**
 * Write the plugin into a Hermes profile that already exists. Hermes still
 * only loads it once `t3-code` is listed under `plugins.enabled` in that
 * profile's config. A failure costs the tools, never the provider.
 */
export const installHermesT3Plugin = Effect.fn("installHermesT3Plugin")(function* (
  environment: NodeJS.ProcessEnv,
  profile: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const profileHome = yield* hermesProfileHome(environment, profile);
  if (profileHome === undefined) return;
  const pluginDirectory = path.join(profileHome, "plugins", HERMES_T3_PLUGIN_NAME);
  const write = (name: string, content: string) =>
    Effect.gen(function* () {
      const target = path.join(pluginDirectory, name);
      const existing = yield* fs.readFileString(target).pipe(Effect.orElseSucceed(() => null));
      if (existing !== content) yield* fs.writeFileString(target, content);
    });
  yield* Effect.gen(function* () {
    if (!(yield* fs.exists(profileHome))) return;
    yield* fs.makeDirectory(pluginDirectory, { recursive: true });
    yield* write("plugin.yaml", HERMES_T3_PLUGIN_MANIFEST);
    yield* write("__init__.py", HERMES_T3_PLUGIN_SOURCE);
  }).pipe(
    Effect.catch(() => Effect.logWarning("Could not write the Hermes t3-code plugin", { profile })),
  );
});
