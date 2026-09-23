import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@t3tools/contracts";
import {
  SHARED_MCP_SERVER_HEADER_REDACTED,
  type SharedMcpServer,
} from "@t3tools/contracts/sharedMcpServers";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ServerSettingsModule from "../serverSettings.ts";

const makeLayer = () =>
  ServerSettingsModule.layer.pipe(
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3code-shared-mcp-settings-test-" }),
      ),
    ),
  );

const TOKEN = "Bearer executor-token";

const executor = (headerValue: string): SharedMcpServer => ({
  name: "executor",
  url: "http://127.0.0.1:4788/mcp",
  headers: [
    { name: "Authorization", value: headerValue },
    { name: "X-Workspace", value: "" },
  ],
  enabled: true,
  disabledProviderInstances: [ProviderInstanceId.make("codex")],
});

it.layer(NodeServices.layer)("shared MCP server headers", (it) => {
  it.effect("stores header values in the secret store and redacts them everywhere else", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettingsModule.ServerSettingsService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;

      const saved = yield* settings.updateSettings({ mcpServers: [executor(TOKEN)] });
      assert.equal(saved.mcpServers[0]?.headers[0]?.value, TOKEN);
      assert.equal(saved.mcpServers[0]?.headers[1]?.value, "");
      assert.deepEqual(saved.mcpServers[0]?.disabledProviderInstances, [
        ProviderInstanceId.make("codex"),
      ]);

      const onDisk = yield* fs.readFileString(config.settingsPath);
      assert.notInclude(onDisk, TOKEN);
      assert.include(onDisk, SHARED_MCP_SERVER_HEADER_REDACTED);

      const client = ServerSettingsModule.redactServerSettingsForClient(saved);
      assert.equal(client.mcpServers[0]?.headers[0]?.value, SHARED_MCP_SERVER_HEADER_REDACTED);
      assert.equal(client.mcpServers[0]?.headers[1]?.value, "");

      // A client echoing its redacted snapshot (here toggling the server off) keeps the value.
      yield* settings.updateSettings({
        mcpServers: [{ ...executor(SHARED_MCP_SERVER_HEADER_REDACTED), enabled: false }],
      });
      const toggled = yield* settings.getSettings;
      assert.isFalse(toggled.mcpServers[0]?.enabled);
      assert.equal(toggled.mcpServers[0]?.headers[0]?.value, TOKEN);

      // Removing the server deletes its secret: re-adding it with only the marker reads empty.
      yield* settings.updateSettings({ mcpServers: [] });
      yield* settings.updateSettings({
        mcpServers: [executor(SHARED_MCP_SERVER_HEADER_REDACTED)],
      });
      assert.equal((yield* settings.getSettings).mcpServers[0]?.headers[0]?.value, "");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("moves a value typed into settings.json into the secret store", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettingsModule.ServerSettingsService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(
        config.settingsPath,
        `{
          "mcpServers": [
            {
              "name": "executor",
              "url": "http://127.0.0.1:4788/mcp",
              "headers": [{ "name": "Authorization", "value": "${TOKEN}" }]
            }
          ]
        }`,
      );

      // The client only ever saw the marker, and echoes it back with another edit.
      const loaded = yield* settings.getSettings;
      const echoed = ServerSettingsModule.redactServerSettingsForClient(loaded).mcpServers;
      yield* settings.updateSettings({
        mcpServers: echoed.map((server) => ({ ...server, disabledProviderInstances: [] })),
      });

      assert.equal((yield* settings.getSettings).mcpServers[0]?.headers[0]?.value, TOKEN);
      assert.notInclude(yield* fs.readFileString(config.settingsPath), TOKEN);
    }).pipe(Effect.provide(makeLayer())),
  );
});
