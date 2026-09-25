// Tangent(FORK-LAN-001): see docs/fork/lan-fallback.md.
import { LanFallback } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as MobileSecureStorage from "../persistence/mobile-secure-storage";

const storage = MobileSecureStorage.make;
const StoredLanAddressesJson = Schema.fromJsonString(LanFallback.StoredLanAddresses);
const decode = Schema.decodeEffect(StoredLanAddressesJson);
const encode = Schema.encodeEffect(StoredLanAddressesJson);
const cache = new Map<EnvironmentId, Option.Option<LanFallback.StoredLanAddresses>>();

// One key per environment, so concurrent connections never overwrite each other's entry.
const storageKey = (environmentId: EnvironmentId) => `tangent.lan-addresses.v1.${environmentId}`;

const get = Effect.fn("mobile.lanAddresses.get")(
  function* (environmentId: EnvironmentId) {
    const cached = cache.get(environmentId);
    if (cached !== undefined) return cached;
    const raw = yield* storage.getItem(storageKey(environmentId));
    const entry = raw === null ? Option.none() : Option.some(yield* decode(raw));
    cache.set(environmentId, entry);
    return entry;
  },
  Effect.catch((error) =>
    Effect.logWarning("Could not read learned local-network addresses.", { error }).pipe(
      Effect.as(Option.none<LanFallback.StoredLanAddresses>()),
    ),
  ),
);

const put = Effect.fn("mobile.lanAddresses.put")(
  function* (entry: LanFallback.StoredLanAddresses) {
    cache.set(entry.environmentId, Option.some(entry));
    yield* storage.setItem(storageKey(entry.environmentId), yield* encode(entry));
  },
  Effect.catch((error) =>
    Effect.logWarning("Could not save learned local-network addresses.", { error }),
  ),
);

/** Drops an environment's learned addresses when it is removed from the phone. */
export const removeLanAddresses = Effect.fn("mobile.lanAddresses.remove")(
  function* (environmentId: EnvironmentId) {
    cache.set(environmentId, Option.none());
    yield* storage.removeItem(storageKey(environmentId));
  },
  Effect.catch((error) =>
    Effect.logWarning("Could not remove learned local-network addresses.", { error }),
  ),
);

export const lanAddressBookLayer = Layer.succeed(
  LanFallback.LanAddressBook,
  LanFallback.LanAddressBook.of({ get, put }),
);
