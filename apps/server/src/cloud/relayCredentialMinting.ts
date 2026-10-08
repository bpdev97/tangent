import * as Context from "effect/Context";

/**
 * Tangent(FORK-CONNECT-001): whether a linked server issues the credentials
 * the relay requests for a client signed in to T3 Connect.
 *
 * Upstream's clients connect that way, so signing in to the T3 Connect
 * account is enough to get a session. No Tangent client signs in, so the
 * server refuses. This closes the direct path only: the account still
 * controls the tunnel (docs/fork/t3-connect.md). The relay's health checks,
 * webhook deliveries, and tunnel recovery use other requests and are not
 * affected.
 */
export class RelayCredentialMinting extends Context.Reference<boolean>(
  "tangent/cloud/RelayCredentialMinting",
  { defaultValue: () => false },
) {}
