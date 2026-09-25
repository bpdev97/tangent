// Tangent(FORK-LAN-001): see docs/fork/lan-fallback.md.
import * as NodeOS from "node:os";

import type { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { isTailscaleIpv4Address } from "@t3tools/tailscale";

import { formatHostForUrl, isLoopbackHost, isWildcardHost } from "../startupAccess.ts";

type NetworkInterfacesMap = ReturnType<typeof NodeOS.networkInterfaces>;

const isLanAddress = (address: string): boolean =>
  !isLoopbackHost(address) && !address.startsWith("169.254.") && !isTailscaleIpv4Address(address);

/**
 * Plain-HTTP URLs that reach this server on the host's local networks, for clients whose saved
 * address (usually a tailnet one) is unreachable. Empty while the server listens on loopback only.
 */
export function resolveLanHttpBaseUrls(
  host: string | undefined,
  port: number,
  interfaces: NetworkInterfacesMap = NodeOS.networkInterfaces(),
): string[] {
  if (!host || port <= 0 || isLoopbackHost(host)) return [];
  if (!isWildcardHost(host)) {
    return isLanAddress(host) ? [`http://${formatHostForUrl(host)}:${port}`] : [];
  }
  return Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal && entry.family === "IPv4" && isLanAddress(entry.address))
    .map((entry) => `http://${entry.address}:${port}`);
}

/** Adds the host's local-network URLs to the descriptor served at `/.well-known/t3/environment`. */
export const withLanHttpBaseUrls =
  (config: { readonly host: string | undefined; readonly port: number }) =>
  (descriptor: ExecutionEnvironmentDescriptor): ExecutionEnvironmentDescriptor => {
    const lanHttpBaseUrls = resolveLanHttpBaseUrls(config.host, config.port);
    return lanHttpBaseUrls.length === 0 ? descriptor : { ...descriptor, lanHttpBaseUrls };
  };
