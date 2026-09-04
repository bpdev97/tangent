import * as NodeHttp2 from "node:http2";
import * as NodeCrypto from "node:crypto";
import * as NodeTimersPromises from "node:timers/promises";
import { importPKCS8, SignJWT } from "jose";
import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
  RelayAgentAwarenessPreferences,
} from "@t3tools/contracts/relay";

import type { ApnsEnvironment, RelayConfig } from "./config.ts";

const TOKEN_LIFETIME_MS = 50 * 60 * 1_000;
const INVALID_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

export interface ApnsResult {
  readonly ok: boolean;
  readonly status: number;
  readonly reason: string | null;
  readonly apnsId: string | null;
  readonly invalidToken: boolean;
}

export interface ApnsPreparedRequest {
  readonly token: string;
  readonly topic: string;
  readonly pushType: "alert" | "liveactivity";
  readonly priority: "5" | "10";
  readonly payload: unknown;
  readonly environment: ApnsEnvironment;
  readonly collapseId?: string;
}

interface ApnsRequest extends ApnsPreparedRequest {
  readonly apnsId: string;
}

export interface NotificationInput {
  readonly token: string;
  readonly bundleId?: string | null;
  readonly environment?: ApnsEnvironment | null;
  readonly state: RelayAgentActivityState;
}

export interface LiveActivityInput {
  readonly token: string;
  readonly bundleId?: string | null;
  readonly environment?: ApnsEnvironment | null;
  readonly aggregate: RelayAgentActivityAggregateState | null;
  readonly alert: { readonly title: string; readonly body: string } | null;
  readonly event: "update" | "end";
}

export interface ApnsDeliveryClient {
  readonly ready: () => Promise<void>;
  readonly sendNotification: (input: NotificationInput) => Promise<ApnsResult>;
  readonly sendLiveActivity: (input: LiveActivityInput) => Promise<ApnsResult>;
  readonly close?: () => Promise<void> | void;
}

interface CachedProviderToken {
  readonly value: string;
  readonly createdAt: number;
}

export class ApnsClient implements ApnsDeliveryClient {
  readonly #config: RelayConfig["apns"];
  #key: Promise<CryptoKey> | null = null;
  #token: CachedProviderToken | null = null;
  readonly #sessions = new Map<ApnsEnvironment, NodeHttp2.ClientHttp2Session>();

  constructor(config: RelayConfig["apns"]) {
    this.#config = config;
  }

  async ready(): Promise<void> {
    this.#key ??= importPKCS8(this.#config.privateKey, "ES256");
    await this.#key;
  }

  async #providerToken(): Promise<string> {
    const now = Date.now();
    if (this.#token && now - this.#token.createdAt < TOKEN_LIFETIME_MS) {
      return this.#token.value;
    }
    this.#key ??= importPKCS8(this.#config.privateKey, "ES256");
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.#config.keyId })
      .setIssuer(this.#config.teamId)
      .setIssuedAt(Math.floor(now / 1_000))
      .sign(await this.#key);
    this.#token = { value, createdAt: now };
    return value;
  }

  #discardSession(environment: ApnsEnvironment, session: NodeHttp2.ClientHttp2Session): void {
    if (this.#sessions.get(environment) === session) this.#sessions.delete(environment);
  }

  #session(environment: ApnsEnvironment): NodeHttp2.ClientHttp2Session {
    const existing = this.#sessions.get(environment);
    if (existing && !existing.closed && !existing.destroyed) return existing;

    const host =
      environment === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com";
    const session = NodeHttp2.connect(host);
    this.#sessions.set(environment, session);
    session.once("close", () => this.#discardSession(environment, session));
    session.once("goaway", () => {
      this.#discardSession(environment, session);
      session.close();
    });
    session.on("error", () => {
      this.#discardSession(environment, session);
      if (!session.destroyed) session.destroy();
    });
    return session;
  }

  async #sendOnce(request: ApnsRequest): Promise<ApnsResult> {
    const authorization = `bearer ${await this.#providerToken()}`;
    const body = JSON.stringify(request.payload);

    return await new Promise<ApnsResult>((resolve, reject) => {
      const session = this.#session(request.environment);
      let settled = false;
      let stream: NodeHttp2.ClientHttp2Stream | undefined;
      const finish = (result: ApnsResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        stream?.close(NodeHttp2.constants.NGHTTP2_CANCEL);
        reject(error);
      };
      try {
        stream = session.request({
          ":method": "POST",
          ":path": `/3/device/${request.token}`,
          authorization,
          "apns-topic": request.topic,
          "apns-push-type": request.pushType,
          "apns-priority": request.priority,
          "apns-id": request.apnsId,
          "content-type": "application/json",
          ...(request.collapseId ? { "apns-collapse-id": request.collapseId } : {}),
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      let status = 0;
      let apnsId: string | null = null;
      let responseBody = "";
      stream.setTimeout(10_000, () => {
        this.#discardSession(request.environment, session);
        session.destroy();
        fail(new Error("APNs request timed out"));
      });
      stream.setEncoding("utf8");
      stream.on("response", (headers) => {
        status = Number(headers[":status"] ?? 0);
        apnsId = typeof headers["apns-id"] === "string" ? headers["apns-id"] : null;
      });
      stream.on("data", (chunk: string) => {
        if (responseBody.length < 16_384) {
          responseBody += chunk.slice(0, 16_384 - responseBody.length);
        }
      });
      stream.once("end", () => {
        let reason: string | null = null;
        if (responseBody) {
          try {
            const parsed = JSON.parse(responseBody) as { reason?: unknown };
            reason = typeof parsed.reason === "string" ? parsed.reason : responseBody;
          } catch {
            reason = responseBody;
          }
        }
        finish({
          ok: status === 200,
          status,
          reason,
          apnsId,
          invalidToken: status === 410 || (reason !== null && INVALID_TOKEN_REASONS.has(reason)),
        });
      });
      stream.once("error", fail);
      stream.end(body);
    });
  }

  async #send(input: ApnsPreparedRequest): Promise<ApnsResult> {
    const request = { ...input, apnsId: NodeCrypto.randomUUID() };
    const sendAttempt = async (attempt: number): Promise<ApnsResult> => {
      try {
        const result = await this.#sendOnce(request);
        const retryable = result.status === 429 || result.status >= 500;
        if (!retryable || attempt === 2) return result;
      } catch (error) {
        if (attempt === 2) throw error;
      }
      await NodeTimersPromises.setTimeout(250 * 2 ** attempt);
      return sendAttempt(attempt + 1);
    };
    return sendAttempt(0);
  }

  sendNotification(input: NotificationInput): Promise<ApnsResult> {
    return this.#send(makeNotificationRequest(this.#config, input));
  }

  sendLiveActivity(input: LiveActivityInput): Promise<ApnsResult> {
    return this.#send(makeLiveActivityRequest(this.#config, input));
  }

  close(): void {
    for (const session of this.#sessions.values()) session.close();
    this.#sessions.clear();
  }
}

export function makeNotificationRequest(
  config: RelayConfig["apns"],
  input: NotificationInput,
): ApnsPreparedRequest {
  return {
    token: input.token,
    topic: input.bundleId ?? config.bundleId,
    pushType: "alert",
    priority: "10",
    environment: input.environment ?? config.environment,
    collapseId: NodeCrypto.createHash("sha256")
      .update(`${input.state.environmentId}:${input.state.threadId}`)
      .digest("hex"),
    payload: {
      aps: {
        alert: {
          title: input.state.threadTitle,
          body: `${statusForPhase(input.state.phase)}: ${input.state.projectTitle}`,
        },
        sound: "default",
      },
      environmentId: input.state.environmentId,
      threadId: input.state.threadId,
      deepLink: input.state.deepLink,
    },
  };
}

export function makeLiveActivityRequest(
  config: RelayConfig["apns"],
  input: LiveActivityInput,
  now = Date.now(),
): ApnsPreparedRequest {
  const timestamp = Math.floor(now / 1_000);
  const contentState = input.aggregate
    ? { "content-state": { name: "AgentActivity", props: JSON.stringify(input.aggregate) } }
    : {};
  return {
    token: input.token,
    topic: `${input.bundleId ?? config.bundleId}.push-type.liveactivity`,
    pushType: "liveactivity",
    priority: input.event === "update" && input.alert === null ? "5" : "10",
    environment: input.environment ?? config.environment,
    payload: {
      aps:
        input.event === "update"
          ? {
              timestamp,
              event: input.event,
              ...contentState,
              "stale-date": timestamp + 10 * 60,
              ...(input.alert ? { alert: { ...input.alert, sound: "default" } } : {}),
            }
          : {
              timestamp,
              event: input.event,
              ...contentState,
              "dismissal-date": timestamp,
              ...(input.alert ? { alert: { ...input.alert, sound: "default" } } : {}),
            },
    },
  };
}

function statusForPhase(phase: RelayAgentActivityState["phase"]): string {
  switch (phase) {
    case "waiting_for_approval":
      return "Approval needed";
    case "waiting_for_input":
      return "Input needed";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "starting":
      return "Connecting";
    case "running":
      return "Working";
    case "stale":
      return "Waiting";
  }
}

export function shouldNotify(input: {
  readonly state: RelayAgentActivityState | null;
  readonly previous: RelayAgentActivityState["phase"] | null;
  readonly preferences: RelayAgentAwarenessPreferences;
}): boolean {
  const state = input.state;
  if (!state || !input.preferences.notificationsEnabled) return false;
  if (input.previous === state.phase) return false;
  switch (state.phase) {
    case "waiting_for_approval":
      return input.preferences.notifyOnApproval;
    case "waiting_for_input":
      return input.preferences.notifyOnInput;
    case "completed":
      return input.preferences.notifyOnCompletion;
    case "failed":
      return input.preferences.notifyOnFailure;
    default:
      return false;
  }
}

export function liveActivityAlert(input: {
  readonly state: RelayAgentActivityState | null;
  readonly previous: RelayAgentActivityState["phase"] | null;
  readonly preferences: RelayAgentAwarenessPreferences;
}): { readonly title: string; readonly body: string } | null {
  if (!shouldNotify(input) || !input.state) return null;
  return {
    title: input.state.threadTitle,
    body: `${statusForPhase(input.state.phase)}: ${input.state.projectTitle}`,
  };
}
