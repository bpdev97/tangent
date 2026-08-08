import { assert, it, vi } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerSettings from "../serverSettings.ts";
import { LinearIntegration, layer, linearFailureTtl } from "./LinearIntegration.ts";

const prUrl = "https://github.com/owner/repository/pull/42";

function makeLayer(
  respond: (request: HttpClientRequest.HttpClientRequest, call: number) => Response,
) {
  let calls = 0;
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) => {
    calls += 1;
    return Effect.succeed(HttpClientResponse.fromWeb(request, respond(request, calls)));
  });
  return {
    execute,
    layer: layer.pipe(
      Layer.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => execute(request)),
        ),
      ),
      Layer.provide(
        ServerSettings.layerTest({
          linearIntegration: {
            apiKey: "lin_api_secret",
            prBadgeBehavior: "linear-review",
            reviewRepositories: ["owner/repository"],
          },
        }),
      ),
    ),
  };
}

function attachmentResponse() {
  return Response.json({
    data: {
      attachmentsForURL: {
        nodes: [
          {
            issue: {
              id: "issue-1",
              identifier: "T3-123",
              title: "Add Linear destinations",
              url: "https://linear.app/example/issue/T3-123/add-linear-destinations",
            },
          },
          {
            issue: {
              id: "issue-1",
              identifier: "T3-123",
              title: "Add Linear destinations",
              url: "https://linear.app/example/issue/T3-123/add-linear-destinations",
            },
          },
        ],
      },
    },
  });
}

it.effect("resolves linked tickets and eligible Linear Review URLs", () => {
  const harness = makeLayer((request) => {
    assert.equal(request.headers.authorization, "lin_api_secret");
    return attachmentResponse();
  });
  return Effect.gen(function* () {
    const linear = yield* LinearIntegration;
    const result = yield* linear.resolvePrDestinations({ prUrl });

    assert.deepEqual(result, {
      status: "resolved",
      tickets: [
        {
          id: "issue-1",
          identifier: "T3-123",
          title: "Add Linear destinations",
          url: "https://linear.app/example/issue/T3-123/add-linear-destinations",
        },
      ],
      review: { url: "https://linear.review/owner/repository/pull/42" },
      stale: false,
    });
    assert.equal(harness.execute.mock.calls.length, 1);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("keeps successful destinations for one hour and supports manual refresh", () => {
  const harness = makeLayer(() => attachmentResponse());
  return Effect.gen(function* () {
    const linear = yield* LinearIntegration;
    yield* linear.resolvePrDestinations({ prUrl });
    yield* TestClock.adjust(Duration.minutes(59));
    yield* linear.resolvePrDestinations({ prUrl });
    assert.equal(harness.execute.mock.calls.length, 1);

    yield* linear.resolvePrDestinations({ prUrl, refresh: true });
    assert.equal(harness.execute.mock.calls.length, 2);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("retains the last successful result across a transient failure", () => {
  const harness = makeLayer((_request, call) =>
    call === 1 ? attachmentResponse() : new Response("unavailable", { status: 503 }),
  );
  return Effect.gen(function* () {
    const linear = yield* LinearIntegration;
    yield* linear.resolvePrDestinations({ prUrl });
    const result = yield* linear.resolvePrDestinations({ prUrl, refresh: true });

    assert.equal(result.status, "resolved");
    assert.isTrue(result.stale);
    assert.equal(result.tickets[0]?.identifier, "T3-123");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("does not reuse a successful result after an authorization failure", () => {
  const harness = makeLayer((_request, call) =>
    call === 1 ? attachmentResponse() : new Response("unauthorized", { status: 401 }),
  );
  return Effect.gen(function* () {
    const linear = yield* LinearIntegration;
    yield* linear.resolvePrDestinations({ prUrl });
    const result = yield* linear.resolvePrDestinations({ prUrl, refresh: true });

    assert.equal(result.status, "unauthorized");
    assert.isFalse(result.stale);
    assert.isEmpty(result.tickets);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("tests the configured Linear workspace", () => {
  const harness = makeLayer(() => Response.json({ data: { organization: { name: "T3 Code" } } }));
  return Effect.gen(function* () {
    const linear = yield* LinearIntegration;
    assert.deepEqual(yield* linear.testConnection, {
      ok: true,
      workspaceName: "T3 Code",
    });
  }).pipe(Effect.provide(harness.layer));
});

it("backs failed lookups off from 20 seconds to 15 minutes", () => {
  assert.equal(Duration.toMillis(linearFailureTtl(1)), Duration.toMillis(Duration.seconds(20)));
  assert.equal(Duration.toMillis(linearFailureTtl(2)), Duration.toMillis(Duration.seconds(40)));
  assert.equal(Duration.toMillis(linearFailureTtl(99)), Duration.toMillis(Duration.minutes(15)));
});
