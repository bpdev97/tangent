import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { HermesGatewayEvent } from "./HermesGatewayClient.ts";
import { makeHermesGatewayUtility } from "./HermesGatewayUtility.ts";

it.effect("refreshes provider configuration and reconnects after gateway loss", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let onEvent: ((event: HermesGatewayEvent) => void) | undefined;
      let connections = 0;
      let configured = false;
      let model = "first-model";
      const utility = yield* makeHermesGatewayUtility(
        { binaryPath: "hermes", profile: "default" },
        {},
        {
          connect: (handler) =>
            Effect.sync(() => {
              onEvent = handler;
              connections += 1;
              return {
                request: async <T>(method: string) =>
                  (method === "model.options"
                    ? { model }
                    : { provider_configured: configured }) as T,
                close: () => undefined,
              };
            }),
        },
      );
      assert.equal((yield* utility.getModels).model, "first-model");
      assert.isFalse((yield* utility.getSetupStatus).provider_configured);
      model = "updated-model";
      configured = true;
      assert.equal((yield* utility.getModels).model, "updated-model");
      assert.isTrue((yield* utility.getSetupStatus).provider_configured);
      assert.equal(connections, 1);
      onEvent?.({ type: "transport.closed" });
      assert.equal((yield* utility.getModels).model, "updated-model");
      assert.equal(connections, 2);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);
