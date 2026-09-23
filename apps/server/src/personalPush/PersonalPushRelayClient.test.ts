import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts/settings";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, vi } from "vite-plus/test";

import { configFromSettings, make } from "./PersonalPushRelayClient.ts";

afterEach(() => vi.unstubAllGlobals());

describe("personal push relay settings", () => {
  it("uses environment configuration when saved settings are empty", () => {
    const config = configFromSettings(DEFAULT_SERVER_SETTINGS, {
      personalPushRelayUrl: "https://environment.example.ts.net",
      personalPushRelayToken: "environment-password",
    });

    expect(make(config)).toMatchObject({
      configured: true,
      relayUrl: "https://environment.example.ts.net",
    });
  });

  it("prefers saved server settings over environment configuration", () => {
    const config = configFromSettings(
      {
        ...DEFAULT_SERVER_SETTINGS,
        personalPushRelay: {
          url: "https://settings.example.ts.net/",
          password: "settings-password",
        },
      },
      {
        personalPushRelayUrl: "https://environment.example.ts.net",
        personalPushRelayToken: "environment-password",
      },
    );

    expect(config).toEqual({
      personalPushRelayUrl: "https://settings.example.ts.net/",
      personalPushRelayToken: "settings-password",
    });
    expect(make(config)).toMatchObject({
      configured: true,
      relayUrl: "https://settings.example.ts.net",
    });
  });

  it.effect("authenticates the connection-test snapshot request with the saved password", () => {
    const fetchMock = vi.fn((_request: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      Promise.resolve(Response.json({ aggregate: null })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = make({
      personalPushRelayUrl: "https://relay.example.test",
      personalPushRelayToken: "saved-relay-password",
    });

    return Effect.gen(function* () {
      expect(yield* client.snapshot()).toEqual({ aggregate: null });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [request, init] = fetchMock.mock.calls[0]!;
      const url = request instanceof Request ? request.url : String(request);
      const headers = request instanceof Request ? request.headers : new Headers(init?.headers);
      expect(url).toBe("https://relay.example.test/v1/agent-activity");
      expect(headers.get("authorization")).toBe("Bearer saved-relay-password");
    });
  });
});
