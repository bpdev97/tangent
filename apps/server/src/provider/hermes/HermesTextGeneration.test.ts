import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { expect } from "vite-plus/test";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import type { HermesGatewayUtility } from "./HermesGatewayUtility.ts";
import { makeHermesTextGeneration } from "./HermesTextGeneration.ts";

it.effect("generates structured text through the stateless Hermes gateway utility", () =>
  Effect.gen(function* () {
    const prompts: string[] = [];
    const utility: HermesGatewayUtility = {
      getModels: Effect.succeed({ providers: [] }),
      getCommands: Effect.succeed({ pairs: [] }),
      getSetupStatus: Effect.succeed({ provider_configured: true }),
      generate: ({ prompt }) => {
        prompts.push(prompt);
        return Effect.succeed({
          text: JSON.stringify({ title: "Hermes gateway title" }),
          response: { stopReason: "end_turn" },
        });
      },
    };
    const textGeneration = yield* makeHermesTextGeneration(utility);
    const result = yield* textGeneration.generateThreadTitle({
      cwd: process.cwd(),
      message: "Build a gateway adapter",
      modelSelection: createModelSelection(
        ProviderInstanceId.make("hermes"),
        "openrouter:x-ai/grok-4.5",
      ),
    });
    expect(result).toEqual({ title: "Hermes gateway title" });
    expect(prompts).toHaveLength(1);
  }),
);
