import * as NodeServices from "@effect/platform-node/NodeServices";
import { PERSONAL_PUSH_RELAY_PASSWORD_REDACTED } from "@t3tools/contracts/personalPush";
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
        ServerConfig.layerTest(process.cwd(), { prefix: "t3code-personal-push-settings-test-" }),
      ),
    ),
  );

const PASSWORD = "relay-password-with-at-least-32-characters";

it.layer(NodeServices.layer)("personal push relay password", (it) => {
  it.effect("stores the password in the secret store and redacts it everywhere else", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettingsModule.ServerSettingsService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;

      const saved = yield* settings.updateSettings({
        personalPushRelay: { url: "https://relay.example.test", password: PASSWORD },
      });
      assert.equal(saved.personalPushRelay.password, PASSWORD);

      const onDisk = yield* fs.readFileString(config.settingsPath);
      assert.notInclude(onDisk, PASSWORD);
      assert.include(onDisk, PERSONAL_PUSH_RELAY_PASSWORD_REDACTED);

      const client = ServerSettingsModule.redactServerSettingsForClient(saved);
      assert.equal(client.personalPushRelay.password, PERSONAL_PUSH_RELAY_PASSWORD_REDACTED);
      assert.equal(client.personalPushRelay.url, "https://relay.example.test");

      // A URL-only change keeps the stored password.
      yield* settings.updateSettings({ personalPushRelay: { url: "https://relay2.example.test" } });
      const reread = yield* settings.getSettings;
      assert.equal(reread.personalPushRelay.url, "https://relay2.example.test");
      assert.equal(reread.personalPushRelay.password, PASSWORD);

      // Echoing the marker back from a client also keeps it.
      yield* settings.updateSettings({
        personalPushRelay: { password: PERSONAL_PUSH_RELAY_PASSWORD_REDACTED },
      });
      assert.equal((yield* settings.getSettings).personalPushRelay.password, PASSWORD);

      // An explicit empty password removes it.
      yield* settings.updateSettings({ personalPushRelay: { password: "" } });
      const cleared = yield* settings.getSettings;
      assert.equal(cleared.personalPushRelay.password, "");
      assert.equal(
        ServerSettingsModule.redactServerSettingsForClient(cleared).personalPushRelay.password,
        "",
      );
    }).pipe(Effect.provide(makeLayer())),
  );
});
