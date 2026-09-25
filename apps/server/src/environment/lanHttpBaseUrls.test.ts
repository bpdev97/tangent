import type * as NodeOS from "node:os";

import { describe, expect, it } from "@effect/vitest";

import { resolveLanHttpBaseUrls } from "./lanHttpBaseUrls.ts";

const address = (value: string, family: "IPv4" | "IPv6" = "IPv4", internal = false) =>
  ({
    address: value,
    family,
    internal,
    netmask: "255.255.255.0",
    mac: "00:00:00:00:00:00",
    cidr: null,
  }) as NodeOS.NetworkInterfaceInfo;

const interfaces = {
  lo0: [address("127.0.0.1", "IPv4", true)],
  en0: [address("fe80::1", "IPv6"), address("192.168.1.20")],
  utun4: [address("100.101.102.103")],
  en5: [address("169.254.10.2")],
  bridge100: [address("192.168.64.1")],
};

describe("resolveLanHttpBaseUrls", () => {
  it("lists every local-network IPv4 address when listening on all interfaces", () => {
    expect(resolveLanHttpBaseUrls("0.0.0.0", 3773, interfaces)).toEqual([
      "http://192.168.1.20:3773",
      "http://192.168.64.1:3773",
    ]);
  });

  it("advertises nothing while listening on loopback", () => {
    expect(resolveLanHttpBaseUrls(undefined, 3773, interfaces)).toEqual([]);
    expect(resolveLanHttpBaseUrls("127.0.0.1", 3773, interfaces)).toEqual([]);
  });

  it("advertises a specific bind address only when it is on the local network", () => {
    expect(resolveLanHttpBaseUrls("192.168.1.20", 3773, interfaces)).toEqual([
      "http://192.168.1.20:3773",
    ]);
    expect(resolveLanHttpBaseUrls("100.101.102.103", 3773, interfaces)).toEqual([]);
  });
});
