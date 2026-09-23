import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  RelayDeviceRegistrationRequest,
  RelayLiveActivityRegistrationRequest,
} from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/unstable/http";

import { authenticateRawRouteWithScope } from "../http.ts";
import * as PersonalPushRelay from "./PersonalPushRelayClient.ts";

const decodeDevice = Schema.decodeUnknownOption(RelayDeviceRegistrationRequest);
const decodeLiveActivity = Schema.decodeUnknownOption(RelayLiveActivityRegistrationRequest);

function relayUnavailable(): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(
    { error: "personal_push_relay_unavailable" },
    { status: 503 },
  );
}

const registerDevice = HttpRouter.add(
  "POST",
  "/api/personal-push/v1/devices",
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const client = yield* PersonalPushRelay.makeFromServices;
    if (!client.configured) return relayUnavailable();
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = decodeDevice(yield* request.json);
    if (Option.isNone(body)) {
      return HttpServerResponse.jsonUnsafe({ error: "invalid_request" }, { status: 400 });
    }
    return yield* client
      .registerDevice(body.value)
      .pipe(
        Effect.as(HttpServerResponse.jsonUnsafe({ ok: true })),
        Effect.orElseSucceed(relayUnavailable),
      );
  }).pipe(Effect.catch(HttpServerRespondable.toResponse)),
);

const registerLiveActivity = HttpRouter.add(
  "POST",
  "/api/personal-push/v1/live-activities",
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const client = yield* PersonalPushRelay.makeFromServices;
    if (!client.configured) return relayUnavailable();
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = decodeLiveActivity(yield* request.json);
    if (Option.isNone(body)) {
      return HttpServerResponse.jsonUnsafe({ error: "invalid_request" }, { status: 400 });
    }
    return yield* client
      .registerLiveActivity(body.value)
      .pipe(
        Effect.as(HttpServerResponse.jsonUnsafe({ ok: true })),
        Effect.orElseSucceed(relayUnavailable),
      );
  }).pipe(Effect.catch(HttpServerRespondable.toResponse)),
);

const snapshot = HttpRouter.add(
  "GET",
  "/api/personal-push/v1/agent-activity",
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    const client = yield* PersonalPushRelay.makeFromServices;
    if (!client.configured) return relayUnavailable();
    return yield* client
      .snapshot()
      .pipe(Effect.map(HttpServerResponse.jsonUnsafe), Effect.orElseSucceed(relayUnavailable));
  }).pipe(Effect.catch(HttpServerRespondable.toResponse)),
);

export const personalPushRouteLayer = Layer.mergeAll(
  registerDevice,
  registerLiveActivity,
  snapshot,
);
