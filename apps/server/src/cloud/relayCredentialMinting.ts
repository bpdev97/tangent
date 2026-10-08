import * as Context from "effect/Context";

/**
 * Tangent(FORK-CONNECT-001): whether a linked server issues the credentials
 * the relay requests for a client signed in to T3 Connect.
 *
 * Upstream's clients connect that way, which makes the T3 Connect account and
 * the relay's signing key a way into the server. No Tangent client signs in,
 * so the server refuses and ordinary pairing stays the only way in. The
 * relay's health checks, webhook deliveries, and tunnel recovery use other
 * requests and are not affected.
 */
export class RelayCredentialMinting extends Context.Reference<boolean>(
  "tangent/cloud/RelayCredentialMinting",
  { defaultValue: () => false },
) {}
