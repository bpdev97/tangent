import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  HERMES_T3_LOADED_FILE,
  HERMES_T3_PLUGIN_SOURCE,
  HERMES_T3_SESSIONS_DIR,
  HERMES_T3_TOOLS_FILE,
} from "./HermesT3PluginSource.ts";
import {
  HERMES_T3_TOOLKITS,
  hermesProfileHome,
  hermesT3ToolManifest,
  installHermesT3Plugin,
  makeHermesT3Bridge,
} from "./HermesT3Tools.ts";

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const SESSION_KEY = "20261007_205424_98ba86";

const attachThread = (threadId: ThreadId, browserToolsAvailable: boolean) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      McpProviderSession.setMcpProviderSession({
        environmentId: EnvironmentId.make("environment:test"),
        threadId,
        providerSessionId: "provider-session:test",
        providerInstanceId: ProviderInstanceId.make("hermes"),
        endpoint: "http://127.0.0.1:1234/mcp",
        authorizationHeader: "Bearer thread-secret",
        browserToolsAvailable,
      }),
    ),
    () => Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId)),
  );

describe("Hermes t3-code tools", () => {
  it.effect("lists every t3-code tool once, with a schema Hermes can register", () =>
    Effect.gen(function* () {
      const manifest = yield* hermesT3ToolManifest;
      const names = manifest.map((tool) => tool.name);
      assert.equal(new Set(names).size, names.length);
      for (const tool of manifest) {
        assert.isNotEmpty(tool.description, tool.name);
        assert.propertyVal(tool.inputSchema, "type", "object", tool.name);
      }
    }),
  );

  // The list is a second copy of what `McpHttpServer.layer` registers. A new
  // toolkit directory, or a tool left out of its directory's toolkit, would
  // otherwise go missing from Hermes without anything failing.
  it.effect("covers every toolkit directory and every tool they define", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const toolkits = path.join(import.meta.dirname, "../../mcp/toolkits");
      const directories: Array<string> = [];
      const literalNames: Array<string> = [];
      let definitions = 0;
      for (const entry of yield* fs.readDirectory(toolkits)) {
        const source = path.join(toolkits, entry, "tools.ts");
        // A file beside the directories has no `tools.ts` under it.
        if (!(yield* fs.exists(source).pipe(Effect.orElseSucceed(() => false)))) continue;
        directories.push(entry);
        const text = yield* fs.readFileString(source);
        definitions += text.split("Tool.make(").length - 1;
        // Most names are literals; `html_render` comes from a shared constant.
        for (const match of text.matchAll(/Tool\.make\(\s*"([^"]+)"/gu))
          literalNames.push(match[1]!);
      }
      const names = (yield* hermesT3ToolManifest).map((tool) => tool.name);
      assert.deepStrictEqual(Object.keys(HERMES_T3_TOOLKITS).toSorted(), directories.toSorted());
      assert.equal(names.length, definitions);
      assert.includeMembers(names, literalNames);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("gives a Hermes session its own thread's credential, and takes it away", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hermes-bridge-" });
      // Left behind by a previous server: must not survive.
      const sessions = path.join(directory, HERMES_T3_SESSIONS_DIR);
      yield* fs.makeDirectory(sessions, { recursive: true });
      yield* fs.writeFileString(path.join(sessions, "stale.json"), "{}");
      yield* fs.writeFileString(path.join(directory, HERMES_T3_LOADED_FILE), "{}");

      const bridge = yield* makeHermesT3Bridge(directory);
      assert.isFalse(yield* fs.exists(path.join(sessions, "stale.json")));
      assert.isFalse(yield* bridge.pluginLoaded);
      assert.isArray(
        decodeJson(yield* fs.readFileString(path.join(directory, HERMES_T3_TOOLS_FILE))),
      );

      const threadId = ThreadId.make("thread:hermes-bridge");
      const sessionFile = path.join(sessions, `${SESSION_KEY}.json`);
      // No credential for the thread yet: nothing is written.
      yield* bridge.attach(SESSION_KEY, threadId);
      assert.isFalse(yield* fs.exists(sessionFile));

      yield* attachThread(threadId, false);
      yield* bridge.attach(SESSION_KEY, threadId);
      const binding = decodeJson(yield* fs.readFileString(sessionFile)) as Record<string, string>;
      assert.equal(binding.endpoint, "http://127.0.0.1:1234/mcp");
      assert.equal(binding.authorization, "Bearer thread-secret");
      // Told how Hermes names the tools, and not about a browser it cannot use.
      assert.include(binding.instructions, "t3code__html_render");
      assert.include(binding.instructions, "Showing visuals");
      assert.notInclude(binding.instructions, "collaborative browser");
      assert.equal((yield* fs.stat(sessionFile)).mode & 0o777, 0o600);
      // A session key is only ever a file name.
      yield* bridge.attach("../escape", threadId);
      assert.isFalse(yield* fs.exists(path.join(directory, "escape.json")));

      yield* bridge.detach(SESSION_KEY);
      assert.isFalse(yield* fs.exists(sessionFile));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("reports the plugin as loaded only for the gateway that is running", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hermes-bridge-" });
      const config = path.join(directory, "config.yaml");
      yield* fs.writeFileString(config, "plugins:\n  enabled: []\n");
      const bridge = yield* makeHermesT3Bridge(directory, config);
      // What the plugin writes when Hermes loads it.
      yield* fs.writeFileString(path.join(directory, HERMES_T3_LOADED_FILE), '{"tools":1}');
      assert.isTrue(yield* bridge.pluginLoaded);
      yield* bridge.gatewayStarting;
      assert.isFalse(yield* bridge.pluginLoaded);

      // Turning the plugin on or off edits the profile's config; only a new gateway sees it.
      // Nothing counts as a change until a gateway has read the config.
      assert.isFalse(yield* bridge.profileConfigChanged);
      yield* bridge.gatewayReady;
      assert.isFalse(yield* bridge.profileConfigChanged);
      // File times are in seconds.
      const later = DateTime.toEpochMillis(yield* DateTime.now) / 1_000 + 60;
      yield* fs.utimes(config, later, later);
      assert.isTrue(yield* bridge.profileConfigChanged);
      // The gateway that replaces it reads the new config.
      yield* bridge.gatewayStarting;
      yield* bridge.gatewayReady;
      assert.isFalse(yield* bridge.profileConfigChanged);

      // A profile set up through its environment has no config until the plugin is enabled.
      yield* fs.remove(config);
      assert.isTrue(yield* bridge.profileConfigChanged);
      yield* bridge.gatewayStarting;
      yield* bridge.gatewayReady;
      assert.isFalse(yield* bridge.profileConfigChanged);
      yield* fs.writeFileString(config, "plugins:\n  enabled:\n    - t3-code\n");
      assert.isTrue(yield* bridge.profileConfigChanged);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("finds a profile's home the way Hermes does", () =>
    Effect.gen(function* () {
      const home = { HOME: "/home/me" };
      assert.equal(yield* hermesProfileHome(home, "default"), "/home/me/.hermes");
      assert.equal(
        yield* hermesProfileHome(home, "Research"),
        "/home/me/.hermes/profiles/research",
      );
      // An exported HERMES_HOME is the root, wherever it is.
      assert.equal(
        yield* hermesProfileHome({ ...home, HERMES_HOME: "/opt/data" }, "default"),
        "/opt/data",
      );
      assert.equal(
        yield* hermesProfileHome({ ...home, HERMES_HOME: "/home/me/.hermes/sandbox" }, "default"),
        "/home/me/.hermes/sandbox",
      );
      // Unless it names a profile: then the root is two levels up.
      assert.equal(
        yield* hermesProfileHome({ ...home, HERMES_HOME: "/opt/data/profiles/a" }, "b"),
        "/opt/data/profiles/b",
      );
      assert.equal(
        yield* hermesProfileHome(
          { ...home, HERMES_HOME: "/home/me/.hermes/profiles/a" },
          "default",
        ),
        "/home/me/.hermes",
      );
      assert.isUndefined(yield* hermesProfileHome(home, "../escape"));
      assert.isUndefined(yield* hermesProfileHome({ HERMES_HOME: "relative/home" }, "default"));
      assert.isUndefined(yield* hermesProfileHome({}, "default"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("writes the plugin into a profile that exists and never creates one", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hermes-home-" });
      const environment = { HOME: "/nonexistent", HERMES_HOME: root };
      yield* installHermesT3Plugin(environment, "missing");
      assert.isFalse(yield* fs.exists(path.join(root, "profiles")));

      yield* installHermesT3Plugin(environment, "default");
      const plugin = path.join(root, "plugins", "t3-code");
      assert.equal(
        yield* fs.readFileString(path.join(plugin, "__init__.py")),
        HERMES_T3_PLUGIN_SOURCE,
      );
      assert.include(yield* fs.readFileString(path.join(plugin, "plugin.yaml")), "name: t3-code");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
