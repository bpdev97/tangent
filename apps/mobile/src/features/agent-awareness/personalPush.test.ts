import { afterEach, vi } from "vite-plus/test";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { EnvironmentId } from "@t3tools/contracts";

import type { SavedRemoteConnection } from "../../lib/connection";
import {
  readPersonalPushSnapshot,
  reconcilePersonalPushConnections,
  registerPersonalPushDevice,
  registerPersonalPushLiveActivity,
} from "./personalPush";

function connection(overrides: Partial<SavedRemoteConnection> = {}): SavedRemoteConnection {
  return {
    environmentId: "env-1" as EnvironmentId,
    environmentLabel: "Desktop",
    pairingUrl: "https://desktop.example/pair",
    displayUrl: "https://desktop.example",
    httpBaseUrl: "https://desktop.example/",
    wsBaseUrl: "wss://desktop.example/ws",
    bearerToken: "bearer-token",
    ...overrides,
  };
}

const empty = new Map<EnvironmentId, SavedRemoteConnection>();

afterEach(() => vi.unstubAllGlobals());

describe("reconcilePersonalPushConnections", () => {
  it("adds direct bearer connections and ignores managed or DPoP ones", () => {
    const result = reconcilePersonalPushConnections(empty, [
      connection(),
      connection({ environmentId: "env-2" as EnvironmentId, relayManaged: true }),
      connection({ environmentId: "env-3" as EnvironmentId, authenticationMethod: "dpop" }),
    ]);
    expect([...result.next.keys()]).toEqual(["env-1"]);
    expect(result).toMatchObject({ addedOrChanged: true, removed: false });
  });

  it("keeps the last endpoint while a prepared connection is briefly unauthenticated", () => {
    const current = reconcilePersonalPushConnections(empty, [connection()]).next;
    const replacing = reconcilePersonalPushConnections(current, [
      connection({ bearerToken: null }),
    ]);
    expect(replacing.next.get("env-1" as EnvironmentId)?.bearerToken).toBe("bearer-token");
    expect(replacing).toMatchObject({ addedOrChanged: false, removed: false });

    const renamed = reconcilePersonalPushConnections(replacing.next, [
      connection({ environmentLabel: "Renamed" }),
    ]);
    expect(renamed).toMatchObject({ addedOrChanged: false, removed: false });
  });

  it("re-registers on credential rotation and reports removal", () => {
    const current = reconcilePersonalPushConnections(empty, [connection()]).next;
    expect(
      reconcilePersonalPushConnections(current, [connection({ bearerToken: "rotated" })])
        .addedOrChanged,
    ).toBe(true);
    const removed = reconcilePersonalPushConnections(current, []);
    expect(removed.next.size).toBe(0);
    expect(removed.removed).toBe(true);
  });
});

describe("personal push requests", () => {
  it.effect("posts registrations through each server with its bearer token", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn((_request: RequestInfo | URL, _init?: RequestInit) =>
        Promise.resolve(Response.json({ ok: true })),
      );
      vi.stubGlobal("fetch", fetchMock);
      const onError = vi.fn();

      const device = yield* registerPersonalPushDevice(
        [connection()],
        { deviceId: "device-1" } as Parameters<typeof registerPersonalPushDevice>[1],
        onError,
      );
      const activity = yield* registerPersonalPushLiveActivity(
        [connection()],
        { deviceId: "device-1", activityPushToken: "activity-token" },
        onError,
      );

      expect(device).toBe(true);
      expect(activity).toBe(true);
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        "https://desktop.example/api/personal-push/v1/devices",
        "https://desktop.example/api/personal-push/v1/live-activities",
      ]);
      const init = fetchMock.mock.calls[1]?.[1];
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer bearer-token");
      expect(JSON.parse(String(init?.body))).toEqual({
        deviceId: "device-1",
        activityPushToken: "activity-token",
      });
      expect(onError).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "reports failure when no server accepts, and reads snapshots from the first that answers",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn((request: RequestInfo | URL) =>
            Promise.resolve(
              String(request).startsWith("https://down.example")
                ? new Response(null, { status: 503 })
                : Response.json({ aggregate: null }),
            ),
          ),
        );
        const down = connection({
          environmentId: "env-down" as EnvironmentId,
          httpBaseUrl: "https://down.example",
        });
        const onError = vi.fn();

        expect(
          yield* registerPersonalPushLiveActivity(
            [down],
            { deviceId: "device-1", activityPushToken: "token" },
            onError,
          ),
        ).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
        expect(yield* readPersonalPushSnapshot([down, connection()])).toEqual({ aggregate: null });
        expect(yield* readPersonalPushSnapshot([down])).toBeNull();
      }),
  );
});
