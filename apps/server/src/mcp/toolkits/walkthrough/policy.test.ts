// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../../config.ts";
import {
  DEFAULT_WALKTHROUGH_POLICY,
  readWalkthroughPolicy,
  WALKTHROUGH_POLICY_FILE,
} from "./policy.ts";

/** A config whose state dir is a fresh temporary directory, released with the test's scope. */
const layerTempConfig = Layer.unwrap(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "walkthrough-policy-" });
    return Layer.succeed(ServerConfig.ServerConfig, {
      stateDir,
    } as ServerConfig.ServerConfig["Service"]);
  }),
).pipe(Layer.provide(NodeServices.layer));

const layer = Layer.mergeAll(layerTempConfig, NodeServices.layer);

describe("readWalkthroughPolicy", () => {
  it.effect("writes the default policy on first read so the owner can find it", () =>
    Effect.gen(function* () {
      const { file, policy } = yield* readWalkthroughPolicy;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      expect(path.basename(file)).toBe(WALKTHROUGH_POLICY_FILE);
      expect(policy).toBe(DEFAULT_WALKTHROUGH_POLICY.trim());
      expect(yield* fileSystem.readFileString(file)).toBe(DEFAULT_WALKTHROUGH_POLICY);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("prefers the owner's edited policy", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fileSystem.writeFileString(
        path.join(config.stateDir, WALKTHROUGH_POLICY_FILE),
        "# Mine\n\nOnly blockers.\n",
      );
      const { policy } = yield* readWalkthroughPolicy;
      expect(policy).toBe("# Mine\n\nOnly blockers.");
    }).pipe(Effect.provide(layer)),
  );
});
