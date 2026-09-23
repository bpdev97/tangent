import * as NodeFS from "node:fs";

export type ApnsEnvironment = "sandbox" | "production";

export interface RelayConfig {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly authToken: string;
  readonly apns: {
    readonly teamId: string;
    readonly keyId: string;
    readonly bundleId: string;
    readonly environment: ApnsEnvironment;
    readonly privateKey: string;
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  const file = env[`${name}_FILE`]?.trim();
  return file ? NodeFS.readFileSync(file, "utf8").trim() : required(env, name);
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "8788", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const environment = env.APNS_ENVIRONMENT?.trim() || "production";
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("APNS_ENVIRONMENT must be sandbox or production");
  }

  const keyPath = required(env, "APNS_PRIVATE_KEY_FILE");
  const privateKey = NodeFS.readFileSync(keyPath, "utf8").trim();
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("APNS_PRIVATE_KEY_FILE does not contain a PKCS#8 private key");
  }
  const authToken = secret(env, "RELAY_AUTH_TOKEN");
  if (authToken.length < 32) {
    throw new Error("RELAY_AUTH_TOKEN must contain at least 32 characters");
  }

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: parsePort(env.PORT),
    databasePath: env.DATABASE_PATH?.trim() || "/data/push-relay.sqlite",
    authToken,
    apns: {
      teamId: required(env, "APNS_TEAM_ID"),
      keyId: required(env, "APNS_KEY_ID"),
      bundleId: required(env, "APNS_BUNDLE_ID"),
      environment,
      privateKey,
    },
  };
}
