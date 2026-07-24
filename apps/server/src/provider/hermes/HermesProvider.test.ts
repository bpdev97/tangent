import { describe, expect, it } from "vite-plus/test";

import {
  buildHermesModelsFromGateway,
  buildHermesSlashCommandsFromGateway,
} from "./HermesProvider.ts";

describe("HermesProvider", () => {
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
