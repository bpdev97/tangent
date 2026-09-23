/**
 * In-process fake Hermes gateway for adapter tests. It stands in for the
 * supervised `hermes serve` runtime: every RPC is recorded and answered from
 * the recorded fixtures (or a per-test override), and tests push gateway
 * events and server→client requests into the connection.
 */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";

import type {
  HermesGatewayConnection,
  HermesGatewayHandlers,
} from "../../provider/hermes/HermesGatewayClient.ts";
import { HermesGatewayRpcError } from "../../provider/hermes/HermesGatewayClient.ts";
import {
  parseHermesGatewayInfo,
  type HermesGatewayInfo,
  type HermesGatewayRuntime,
} from "../../provider/hermes/HermesGatewayRuntime.ts";
import { HERMES_FIXTURE_LIVE_ID, recorded } from "./HermesAdapterV2.fixtures.ts";

export interface RecordedRpc {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface RecordedReply {
  readonly id: string;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: { readonly code: number; readonly message: string };
}

type RpcHandler = (params: Readonly<Record<string, unknown>>) => unknown;

export interface FakeHermesGateway {
  readonly runtime: HermesGatewayRuntime;
  /** Override one method's result; throw `HermesGatewayRpcError` to answer with an error. */
  readonly handle: (method: string, handler: RpcHandler) => void;
  readonly takeRpc: (method: string) => Effect.Effect<RecordedRpc>;
  readonly rpcs: () => ReadonlyArray<RecordedRpc>;
  readonly takeReply: (id: string) => Effect.Effect<RecordedReply>;
  readonly event: (type: string, payload?: unknown, sessionId?: string) => Effect.Effect<void>;
  readonly events: (
    frames: ReadonlyArray<{ readonly type: string; readonly payload?: unknown }>,
    sessionId?: string,
  ) => Effect.Effect<void>;
  /** Push a server→client request; returns its `srq-` id. */
  readonly request: (
    method: string,
    params: Readonly<Record<string, unknown>>,
    sessionId?: string,
  ) => Effect.Effect<string>;
  /** Drop the socket as an unexpected gateway exit would. */
  readonly dropConnection: Effect.Effect<void>;
  readonly connections: () => number;
  readonly activeTurns: () => number;
}

export const makeFakeHermesGateway = Effect.gen(function* () {
  const rpcQueue = yield* Queue.unbounded<RecordedRpc>();
  const replyQueue = yield* Queue.unbounded<RecordedReply>();
  const allRpcs: Array<RecordedRpc> = [];
  const handlers = new Map<string, RpcHandler>();
  const live: Array<HermesGatewayHandlers> = [];
  let connectionCount = 0;
  let requestCounter = 0;
  let turns = 0;
  let info: HermesGatewayInfo | null = null;

  const defaults: Readonly<Record<string, RpcHandler>> = {
    "client.capabilities": () => recorded.clientCapabilities,
    "session.create": () => recorded.sessionCreate,
    "session.resume": (params) => ({
      ...recorded.sessionResume,
      resumed: params.session_id,
      session_key: params.session_id,
    }),
    "prompt.submit": () => recorded.promptSubmit,
    "session.steer": (params) => ({ status: "queued", text: params.text }),
    "session.interrupt": () => ({ status: "interrupted" }),
    "session.undo": () => ({ removed: 2 }),
    "session.close": () => ({ closed: true }),
    "clarify.lock": () => ({ status: "ok" }),
    "config.set": (params) => ({ key: params.key, value: params.value }),
    "session.history": () => ({ count: 0, messages: [] }),
  };

  const connection = (index: number): HermesGatewayConnection => ({
    request: <T>(method: string, params: Readonly<Record<string, unknown>> = {}) => {
      const rpc = { method, params };
      allRpcs.push(rpc);
      Queue.offerUnsafe(rpcQueue, rpc);
      try {
        const handler = handlers.get(method) ?? defaults[method] ?? (() => ({}));
        return Promise.resolve(handler(params) as T);
      } catch (cause) {
        return Promise.reject(cause);
      }
    },
    respond: (id, result) => {
      Queue.offerUnsafe(replyQueue, { id, result });
    },
    respondError: (id, code, message) => {
      Queue.offerUnsafe(replyQueue, { id, error: { code, message } });
    },
    close: () => {
      const handler = live[index];
      if (handler === undefined) return;
      delete live[index];
      handler.onClose?.();
    },
  });

  const push = (fn: (handler: HermesGatewayHandlers) => void) =>
    Effect.sync(() => {
      for (const handler of live) if (handler) fn(handler);
    });

  const runtime: HermesGatewayRuntime = {
    profile: "default",
    binaryPath: "hermes",
    connect: (handler) =>
      Effect.sync(() => {
        connectionCount += 1;
        live.push(handler);
        return connection(live.length - 1);
      }),
    stop: Effect.void,
    info: Effect.sync(() => info),
    noteInfo: (payload) =>
      Effect.sync(() => {
        const parsed = parseHermesGatewayInfo(payload);
        info = {
          version: parsed.version ?? info?.version ?? null,
          contract: parsed.contract ?? info?.contract ?? null,
          updateBehind: parsed.updateBehind ?? info?.updateBehind ?? null,
          updateCommand: parsed.updateCommand ?? info?.updateCommand ?? null,
        };
      }),
    activeTurns: Effect.sync(() => turns),
    trackTurn: Effect.sync(() => {
      turns += 1;
      let released = false;
      return Effect.sync(() => {
        if (!released) {
          released = true;
          turns -= 1;
        }
      });
    }),
    blockStarts: () => Effect.void,
  };

  const takeMatching = <A>(queue: Queue.Queue<A>, predicate: (value: A) => boolean) =>
    Effect.gen(function* () {
      while (true) {
        const value = yield* Queue.take(queue);
        if (predicate(value)) return value;
      }
    });

  return {
    runtime,
    handle: (method, handler) => {
      handlers.set(method, handler);
    },
    takeRpc: (method) => takeMatching(rpcQueue, (rpc) => rpc.method === method),
    rpcs: () => allRpcs,
    takeReply: (id) => takeMatching(replyQueue, (reply) => reply.id === id),
    event: (type, payload = {}, sessionId = HERMES_FIXTURE_LIVE_ID) =>
      push((handler) => handler.onEvent?.({ type, session_id: sessionId, payload })),
    events: (frames, sessionId = HERMES_FIXTURE_LIVE_ID) =>
      push((handler) => {
        for (const frame of frames) {
          handler.onEvent?.({ type: frame.type, session_id: sessionId, payload: frame.payload });
        }
      }),
    request: (method, params, sessionId = HERMES_FIXTURE_LIVE_ID) =>
      Effect.gen(function* () {
        requestCounter += 1;
        const id = `srq-${requestCounter.toString(16).padStart(12, "0")}`;
        yield* push((handler) =>
          handler.onServerRequest?.({ id, method, params: { session_id: sessionId, ...params } }),
        );
        return id;
      }),
    dropConnection: push((handler) => handler.onClose?.()),
    connections: () => connectionCount,
    activeTurns: () => turns,
  } satisfies FakeHermesGateway;
});

export const rpcError = (code: number, message: string) =>
  new HermesGatewayRpcError("fixture", { code, message });
