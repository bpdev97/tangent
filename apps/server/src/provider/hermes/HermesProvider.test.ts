import { describe, expect, it } from "@effect/vitest";
import { HermesSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import {
  buildInitialHermesProviderSnapshot,
  buildHermesModelsFromGateway,
  buildHermesSlashCommandsFromGateway,
} from "./HermesProvider.ts";

describe("HermesProvider", () => {
  it.effect("publishes legacy and named custom models with their option descriptors", () =>
    Effect.gen(function* () {
      const capabilities = {
        optionDescriptors: [
          {
            id: "effort",
            label: "Reasoning",
            type: "select",
            options: [{ id: "high", label: "High", isDefault: true }],
          },
        ],
      };
      const settings = Schema.decodeSync(HermesSettings)({
        customModels: [
          "openrouter:legacy",
          { slug: "openrouter:custom", name: "Research", capabilities },
        ],
      });
      const snapshot = yield* buildInitialHermesProviderSnapshot(settings);

      expect(snapshot.models).toMatchObject([
        { slug: "openrouter:legacy", isCustom: true },
        { slug: "openrouter:custom", name: "Research", isCustom: true, capabilities },
      ]);
    }),
  );
  it("discovers authenticated gateway models with stable provider-qualified ids", () => {
    expect(
      buildHermesModelsFromGateway({
        providers: [
          {
            slug: "openrouter",
            name: "OpenRouter",
            authenticated: true,
            models: ["x-ai/grok-4.5"],
          },
          { slug: "missing", name: "Missing", authenticated: false, models: ["nope"] },
        ],
      }).map((model) => model.slug),
    ).toEqual(["openrouter:x-ai/grok-4.5"]);
  });

  it("normalizes and deduplicates gateway slash commands", () => {
    expect(
      buildHermesSlashCommandsFromGateway({
        pairs: [
          ["/status", "Show session status"],
          ["/deploy", "Run the configured deploy command"],
          ["/plan", "Activate the planning skill"],
          ["/STATUS", "duplicate"],
          ["", "missing"],
          ["/bad command", "invalid"],
        ],
      }),
    ).toEqual([
      { name: "status", description: "Show session status" },
      { name: "deploy", description: "Run the configured deploy command" },
      { name: "plan", description: "Activate the planning skill" },
    ]);
  });
});
