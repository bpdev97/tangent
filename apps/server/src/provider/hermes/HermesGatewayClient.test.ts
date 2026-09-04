import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  HermesGatewayClient,
  HermesGatewayRpcError,
  type HermesWebSocketEvent,
  type HermesWebSocketLike,
} from "./HermesGatewayClient.ts";

class FakeSocket implements HermesWebSocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<(event: HermesWebSocketEvent) => void>>();

  addEventListener(type: string, listener: (event: HermesWebSocketEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: HermesWebSocketEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  frame(frame: unknown): void {
    this.emit("message", { data: JSON.stringify(frame) });
  }

  emit(type: string, event: HermesWebSocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("HermesGatewayClient", () => {
  afterEach(() => vi.useRealTimers());

  it("allows long-running requests while retaining timeouts for control RPCs", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const client = new HermesGatewayClient(() => undefined, { socketFactory: () => socket });
    const connecting = client.connect("ws://hermes.test");
    socket.open();
    socket.frame({ method: "event", params: { type: "gateway.ready" } });
    await connecting;
    const prompt = client.request("prompt.submit", {}, { timeoutMs: null });
    const control = expect(client.request("session.info")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(180_000);
    await control;
    socket.frame({ id: JSON.parse(socket.sent[0]!).id, result: { status: "completed" } });
    await expect(prompt).resolves.toEqual({ status: "completed" });
    client.close();
  });

  it("cancels pending requests and ignores their late responses", async () => {
    const socket = new FakeSocket();
    const client = new HermesGatewayClient(() => undefined, { socketFactory: () => socket });
    const connecting = client.connect("ws://hermes.test");
    socket.open();
    socket.frame({ method: "event", params: { type: "gateway.ready" } });
    await connecting;
    const controller = new AbortController();
    const pending = client.request(
      "prompt.submit",
      {},
      { signal: controller.signal, timeoutMs: null },
    );
    const cancelled = expect(pending).rejects.toThrow("interrupted");
    controller.abort(new Error("interrupted"));
    await cancelled;
    const next = client.request("session.info");
    socket.frame({ id: JSON.parse(socket.sent[0]!).id, error: { message: "late failure" } });
    socket.frame({ id: JSON.parse(socket.sent[1]!).id, result: { running: false } });
    await expect(next).resolves.toEqual({ running: false });
    client.close();
  });

  it("reports unexpected disconnects and rejects in-flight requests", async () => {
    const socket = new FakeSocket();
    const events: string[] = [];
    const client = new HermesGatewayClient((event) => events.push(event.type), {
      socketFactory: () => socket,
    });
    const connecting = client.connect("ws://hermes.test");
    socket.open();
    socket.frame({ method: "event", params: { type: "gateway.ready" } });
    await connecting;
    const pending = expect(
      client.request("prompt.submit", {}, { timeoutMs: null }),
    ).rejects.toThrow("connection closed");
    socket.close();
    await pending;
    client.close();
    expect(events).toEqual(["gateway.ready", "transport.closed"]);
    await expect(client.request("session.info")).rejects.toThrow("not connected");
  });

  it("waits for gateway.ready and correlates JSON-RPC responses", async () => {
    const socket = new FakeSocket();
    const events: string[] = [];
    const client = new HermesGatewayClient((event) => events.push(event.type), {
      socketFactory: () => socket,
    });
    const connecting = client.connect("ws://hermes.test/api/ws?token=secret");
    socket.open();
    socket.frame({
      jsonrpc: "2.0",
      method: "event",
      params: { type: "gateway.ready", payload: {} },
    });
    await connecting;
    const pending = client.request<{ ok: boolean }>("session.interrupt", { session_id: "live" });
    const request = JSON.parse(socket.sent[0]!) as { id: string };
    socket.frame({ jsonrpc: "2.0", id: request.id, result: { ok: true } });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(events).toEqual(["gateway.ready"]);
  });

  it("returns typed RPC failures", async () => {
    const socket = new FakeSocket();
    const client = new HermesGatewayClient(() => undefined, { socketFactory: () => socket });
    const connecting = client.connect("ws://hermes.test");
    socket.open();
    socket.frame({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready" } });
    await connecting;
    const pending = client.request("session.resume", { session_id: "missing" });
    const request = JSON.parse(socket.sent[0]!) as { id: string };
    socket.frame({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: 4007, message: "session not found" },
    });
    await expect(pending).rejects.toMatchObject({
      name: "HermesGatewayRpcError",
      code: 4007,
      message: "session not found",
    } satisfies Partial<HermesGatewayRpcError>);
  });
});
