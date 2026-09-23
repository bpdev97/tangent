/**
 * Minimal JSON-RPC 2.0 client for one Hermes TUI-gateway WebSocket.
 *
 * Three frame kinds arrive on the socket:
 * - `event` notifications (`{method: "event", params: {type, session_id, payload}}`),
 * - responses to our requests (`{id, result | error}`),
 * - server→client requests (`{id: "srq-…", method, params}`) for approvals and
 *   questions, answered with a response frame carrying the same id.
 *
 * @module provider/hermes/HermesGatewayClient
 */

export interface HermesGatewayEvent {
  readonly type: string;
  readonly session_id?: string;
  readonly payload?: unknown;
}

export interface HermesServerRequest {
  readonly id: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface HermesGatewayRpcErrorShape {
  readonly code?: number;
  readonly message?: string;
  readonly data?: unknown;
}

export class HermesGatewayRpcError extends Error {
  readonly code: number | undefined;
  readonly data: unknown;

  constructor(method: string, error: HermesGatewayRpcErrorShape) {
    super(error.message?.trim() || `Hermes gateway request failed: ${method}`);
    this.name = "HermesGatewayRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

interface JsonRpcFrame {
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: HermesGatewayRpcErrorShape;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (cause: unknown) => void;
  readonly cleanup: () => void;
}

export interface HermesWebSocketLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: HermesWebSocketEvent) => void): void;
  removeEventListener(type: string, listener: (event: HermesWebSocketEvent) => void): void;
  send(data: string): void;
  close(): void;
}

export interface HermesWebSocketEvent {
  readonly data?: unknown;
}

export interface HermesGatewayHandlers {
  readonly onEvent?: (event: HermesGatewayEvent) => void;
  readonly onServerRequest?: (request: HermesServerRequest) => void;
  readonly onClose?: () => void;
}

export interface HermesGatewayClientOptions {
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly socketFactory?: (url: string) => HermesWebSocketLike;
}

export interface HermesGatewayRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface HermesGatewayConnection {
  request<T>(
    method: string,
    params?: Readonly<Record<string, unknown>>,
    options?: HermesGatewayRequestOptions,
  ): Promise<T>;
  /** Answer a server→client request. */
  respond(id: string, result: Readonly<Record<string, unknown>>): void;
  /** Refuse a server→client request so Hermes fails fast instead of waiting. */
  respondError(id: string, code: number, message: string): void;
  close(): void;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export class HermesGatewayClient implements HermesGatewayConnection {
  readonly #handlers: HermesGatewayHandlers;
  readonly #connectTimeoutMs: number;
  readonly #requestTimeoutMs: number;
  readonly #socketFactory: ((url: string) => HermesWebSocketLike) | undefined;
  #nextId = 0;
  #socket: HermesWebSocketLike | undefined;
  #pending = new Map<string | number, PendingRequest>();

  constructor(handlers: HermesGatewayHandlers, options: HermesGatewayClientOptions = {}) {
    this.#handlers = handlers;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#socketFactory = options.socketFactory;
  }

  /** Resolves once the socket is open and Hermes has sent `gateway.ready`. */
  async connect(url: string): Promise<void> {
    if (this.#socket) return;
    const socket = this.#socketFactory?.(url) ?? new WebSocket(url);
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      let opened = false;
      let gatewayReady = false;
      // @effect-diagnostics-next-line globalTimers:off - Promise WebSocket boundary.
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for the Hermes gateway to become ready."));
        this.close();
      }, this.#connectTimeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      const settle = () => {
        if (!opened || !gatewayReady) return;
        cleanup();
        resolve();
      };
      const onOpen = () => {
        opened = true;
        settle();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Could not connect to the Hermes gateway."));
        this.close();
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("message", (event) => {
        const frame = parseFrame(event.data);
        if (frame === undefined) return;
        if (frame.method === "event" && eventType(frame.params) === "gateway.ready") {
          gatewayReady = true;
          settle();
        }
        this.#handleFrame(frame);
      });
      socket.addEventListener("close", () => {
        const cause = new Error("Hermes gateway connection closed.");
        cleanup();
        reject(cause);
        if (this.#socket !== socket) return;
        this.#socket = undefined;
        this.#rejectPending(cause);
        this.#handlers.onClose?.();
      });
    });
  }

  request<T>(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    options: HermesGatewayRequestOptions = {},
  ): Promise<T> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== 1) {
      return Promise.reject(new Error("Hermes gateway is not connected."));
    }
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    const id = `t3-${++this.#nextId}`;
    return new Promise<T>((resolve, reject) => {
      const fail = (cause: unknown) => {
        cleanup();
        this.#pending.delete(id);
        reject(cause);
      };
      // @effect-diagnostics-next-line globalTimers:off - Promise WebSocket boundary.
      const timer = setTimeout(
        () => fail(new Error(`Hermes gateway request timed out: ${method}`)),
        options.timeoutMs ?? this.#requestTimeoutMs,
      );
      const onAbort = () => fail(options.signal?.reason);
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        cleanup,
      });
      try {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (cause) {
        fail(cause);
      }
    });
  }

  respond(id: string, result: Readonly<Record<string, unknown>>): void {
    this.#send({ jsonrpc: "2.0", id, result });
  }

  respondError(id: string, code: number, message: string): void {
    this.#send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  close(): void {
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close();
    this.#rejectPending(new Error("Hermes gateway connection closed."));
  }

  #send(frame: Readonly<Record<string, unknown>>): void {
    const socket = this.#socket;
    if (!socket || socket.readyState !== 1) throw new Error("Hermes gateway is not connected.");
    socket.send(JSON.stringify(frame));
  }

  #handleFrame(frame: JsonRpcFrame): void {
    if (frame.method === "event") {
      const event = toEvent(frame.params);
      if (event) this.#handlers.onEvent?.(event);
      return;
    }
    if (typeof frame.method === "string") {
      if (typeof frame.id === "string") {
        this.#handlers.onServerRequest?.({
          id: frame.id,
          method: frame.method,
          params: isRecord(frame.params) ? frame.params : {},
        });
      }
      return;
    }
    if (frame.id === undefined || frame.id === null) return;
    const pending = this.#pending.get(frame.id);
    if (!pending) return;
    pending.cleanup();
    this.#pending.delete(frame.id);
    if (frame.error) pending.reject(new HermesGatewayRpcError(pending.method, frame.error));
    else pending.resolve(frame.result);
  }

  #rejectPending(cause: unknown): void {
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(cause);
    }
    this.#pending.clear();
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFrame(data: unknown): JsonRpcFrame | undefined {
  try {
    const parsed: unknown = JSON.parse(typeof data === "string" ? data : String(data));
    return isRecord(parsed) ? (parsed as JsonRpcFrame) : undefined;
  } catch {
    return undefined;
  }
}

function eventType(params: unknown): string | undefined {
  return isRecord(params) && typeof params.type === "string" ? params.type : undefined;
}

function toEvent(params: unknown): HermesGatewayEvent | undefined {
  if (!isRecord(params) || typeof params.type !== "string") return undefined;
  return {
    type: params.type,
    ...(typeof params.session_id === "string" ? { session_id: params.session_id } : {}),
    ...(params.payload !== undefined ? { payload: params.payload } : {}),
  };
}
