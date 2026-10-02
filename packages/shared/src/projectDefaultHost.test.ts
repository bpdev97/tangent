import { describe, expect, it } from "vite-plus/test";

import {
  resolveProjectDefaultHostMember,
  sanitizeProjectDefaultHosts,
  setProjectDefaultHost,
} from "./projectDefaultHost.ts";

const laptop = { environmentId: "laptop", id: "a" };
const server = { environmentId: "server", id: "b" };
const serverSecondCheckout = { environmentId: "server", id: "c" };
const members = [laptop, server, serverSecondCheckout];
const connected = (ids: ReadonlyArray<string>) => (id: string) => ids.includes(id);

describe("project default host", () => {
  it("starts on the default host's member when that host is connected", () => {
    expect(
      resolveProjectDefaultHostMember({
        members,
        defaultEnvironmentId: "server",
        isEnvironmentConnected: connected(["laptop", "server"]),
      }),
    ).toBe(server);
  });

  it("keeps the caller's checkout when it is already on the default host", () => {
    expect(
      resolveProjectDefaultHostMember({
        members,
        defaultEnvironmentId: "server",
        isEnvironmentConnected: connected(["server"]),
        preferred: serverSecondCheckout,
      }),
    ).toBe(serverSecondCheckout);
  });

  it("falls back when there is no default, the host is offline, or it lacks the project", () => {
    const isEnvironmentConnected = connected(["laptop", "server", "other"]);
    expect(
      resolveProjectDefaultHostMember({
        members,
        defaultEnvironmentId: undefined,
        isEnvironmentConnected,
      }),
    ).toBeNull();
    expect(
      resolveProjectDefaultHostMember({
        members,
        defaultEnvironmentId: "server",
        isEnvironmentConnected: connected(["laptop"]),
      }),
    ).toBeNull();
    expect(
      resolveProjectDefaultHostMember({
        members,
        defaultEnvironmentId: "other",
        isEnvironmentConnected,
      }),
    ).toBeNull();
  });

  it("sets and clears one project's default without touching others", () => {
    const hosts = setProjectDefaultHost({ other: "laptop" }, "project", "server");
    expect(hosts).toEqual({ other: "laptop", project: "server" });
    expect(setProjectDefaultHost(hosts, "project", null)).toEqual({ other: "laptop" });
  });

  it("keeps only valid stored entries", () => {
    expect(sanitizeProjectDefaultHosts({ project: "server", bad: 3, empty: "" })).toEqual({
      project: "server",
    });
    expect(sanitizeProjectDefaultHosts({ bad: 3 })).toBeNull();
    expect(sanitizeProjectDefaultHosts(["server"])).toBeNull();
    expect(sanitizeProjectDefaultHosts(undefined)).toBeNull();
  });
});
