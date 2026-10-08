// @effect-diagnostics nodeBuiltinImport:off - Dependency-free release bootstrap runs before install.
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";

/**
 * Tangent(FORK-CONNECT-001): the public values that let a Tangent server link
 * to T3 Connect, read from upstream's own `.env.example` so a release follows
 * upstream when it changes them.
 *
 * `T3CODE_CLERK_JWT_TEMPLATE` is left out on purpose: web, desktop, and mobile
 * only show T3 Connect sign-in when it is set, and sign-in does not work for
 * Tangent's app identity.
 */
const PERSONAL_CONNECT_ENV_KEYS = [
  "T3CODE_RELAY_URL",
  "T3CODE_CLERK_PUBLISHABLE_KEY",
  "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
] as const;

export function resolvePersonalConnectEnv(envExample: string): ReadonlyArray<string> {
  const values = NodeUtil.parseEnv(envExample);
  return PERSONAL_CONNECT_ENV_KEYS.map((key) => {
    const value = values[key]?.trim();
    if (!value) throw new Error(`.env.example no longer sets ${key}; see docs/fork/t3-connect.md.`);
    return `${key}=${value}`;
  });
}

if (import.meta.main) {
  // @effect-diagnostics-next-line globalConsole:off - Dependency-free release bootstrap writes to stdout.
  console.log(resolvePersonalConnectEnv(NodeFS.readFileSync(".env.example", "utf8")).join("\n"));
}
