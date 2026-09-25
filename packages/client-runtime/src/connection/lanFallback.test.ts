import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import type { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import * as LanFallback from "./lanFallback.ts";
import { ConnectionTransientError } from "./model.ts";

const environmentId = EnvironmentId.make("environment-1");
const saved = { httpBaseUrl: "https://mac.tailnet.ts.net", wsBaseUrl: "wss://mac.tailnet.ts.net" };
const lan = "http://192.168.1.20:3773";
const input = {
  expectedEnvironmentId: environmentId,
  ...saved,
  bearerToken: "token",
  connectionMethod: "direct" as const,
};

const unreachable = (httpBaseUrl: string) =>
  new ConnectionTransientError({ reason: "network", detail: `${httpBaseUrl} is unreachable` });

/** A remote whose behavior per address is `ok`, `fail`, or `hang`. */
const fakeRemote = (behavior: Record<string, "ok" | "fail" | "hang">) => {
  const attempted: string[] = [];
  const remote = {
    authorizeBearer: (request: { readonly httpBaseUrl: string; readonly wsBaseUrl: string }) =>
      Effect.suspend(() => {
        attempted.push(request.httpBaseUrl);
        switch (behavior[request.httpBaseUrl]) {
          case "ok":
            return Effect.succeed({
              environmentId,
              label: "Mac",
              httpBaseUrl: request.httpBaseUrl,
              socketUrl: `${request.wsBaseUrl}/ws`,
              httpAuthorization: { _tag: "Bearer" as const, token: "token" },
            });
          case "hang":
            return Effect.never;
          default:
            return Effect.fail(unreachable(request.httpBaseUrl));
        }
      }),
    authorizeDpop: () => Effect.die("unused"),
    authorizeDpopHttp: () => Effect.die("unused"),
  } satisfies RemoteEnvironmentAuthorization["Service"];
  return { remote, attempted };
};

const withBook = (stored: LanFallback.StoredLanAddresses | undefined) => {
  const puts: LanFallback.StoredLanAddresses[] = [];
  const book = LanFallback.LanAddressBook.of({
    get: () => Effect.succeed(Option.fromUndefinedOr(stored)),
    put: (entry) => Effect.sync(() => void puts.push(entry)),
  });
  return { puts, provide: Effect.provideService(LanFallback.LanAddressBook, book) };
};

const learned = { environmentId, httpBaseUrls: [lan] };

describe("lanFallbackCandidates", () => {
  it("puts the address that connected last first and skips duplicates of the saved one", () => {
    const candidates = LanFallback.lanFallbackCandidates(saved, {
      environmentId,
      httpBaseUrls: [saved.httpBaseUrl, lan],
      preferredHttpBaseUrl: lan,
    });
    expect(candidates).toEqual([{ httpBaseUrl: lan, wsBaseUrl: "ws://192.168.1.20:3773/" }, saved]);
  });
});

describe("nextStoredLanAddresses", () => {
  const base = { environmentId, savedHttpBaseUrl: saved.httpBaseUrl };

  it("learns advertised addresses only through the saved address", () => {
    expect(
      LanFallback.nextStoredLanAddresses({
        ...base,
        connectedHttpBaseUrl: saved.httpBaseUrl,
        advertisedHttpBaseUrls: [lan],
        stored: undefined,
      }),
    ).toEqual({ ...learned, preferredHttpBaseUrl: saved.httpBaseUrl });
    expect(
      LanFallback.nextStoredLanAddresses({
        ...base,
        connectedHttpBaseUrl: lan,
        advertisedHttpBaseUrls: ["http://10.0.0.9:3773"],
        stored: learned,
      }),
    ).toEqual({ ...learned, preferredHttpBaseUrl: lan });
  });

  it("writes nothing when nothing changed or nothing was learned", () => {
    expect(
      LanFallback.nextStoredLanAddresses({
        ...base,
        connectedHttpBaseUrl: lan,
        advertisedHttpBaseUrls: undefined,
        stored: { ...learned, preferredHttpBaseUrl: lan },
      }),
    ).toBeNull();
    expect(
      LanFallback.nextStoredLanAddresses({
        ...base,
        connectedHttpBaseUrl: saved.httpBaseUrl,
        advertisedHttpBaseUrls: undefined,
        stored: undefined,
      }),
    ).toBeNull();
  });
});

describe("authorizeBearer", () => {
  it.effect("falls back to the local network when the saved address hangs", () =>
    Effect.gen(function* () {
      const { remote, attempted } = fakeRemote({ [saved.httpBaseUrl]: "hang", [lan]: "ok" });
      const { provide } = withBook(learned);
      const fallback = yield* LanFallback.make.pipe(provide);
      const fiber = yield* fallback.authorizeBearer(remote, input).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(attempted).toEqual([saved.httpBaseUrl]);
      yield* TestClock.adjust(LanFallback.LAN_FALLBACK_HEAD_START_MS);
      const authorized = yield* Fiber.join(fiber);
      expect(authorized.httpBaseUrl).toBe(lan);
    }),
  );

  it.effect("tries alternates at once when the first address fails fast", () =>
    Effect.gen(function* () {
      const { remote } = fakeRemote({ [saved.httpBaseUrl]: "fail", [lan]: "ok" });
      const { provide } = withBook(learned);
      const fallback = yield* LanFallback.make.pipe(provide);
      const authorized = yield* fallback.authorizeBearer(remote, input);
      expect(authorized.httpBaseUrl).toBe(lan);
    }),
  );

  it.effect("reports the saved address's error when every address fails", () =>
    Effect.gen(function* () {
      const { remote } = fakeRemote({});
      const { provide } = withBook({ ...learned, preferredHttpBaseUrl: lan });
      const fallback = yield* LanFallback.make.pipe(provide);
      const error = yield* fallback.authorizeBearer(remote, input).pipe(Effect.flip);
      expect(error).toEqual(unreachable(saved.httpBaseUrl));
    }),
  );

  it.effect("uses only the saved address when the platform stores no addresses", () =>
    Effect.gen(function* () {
      const { remote, attempted } = fakeRemote({ [saved.httpBaseUrl]: "ok" });
      const fallback = yield* LanFallback.make;
      yield* fallback.authorizeBearer(remote, input);
      expect(attempted).toEqual([saved.httpBaseUrl]);
    }),
  );
});
