import { describe, expect, it, vi } from "vite-plus/test";

import { openLinearDestination } from "./openLinearDestination";

const TICKET_URL = "https://linear.app/tangent/issue/TAN-42/native-ticket-opening";
const REVIEW_URL = "https://linear.review/bpdev97/tangent/pull/52";

describe("openLinearDestination", () => {
  it("opens destinations in the side panel by default", async () => {
    const openInSidePanel = vi.fn();
    const openExternal = vi.fn();

    await openLinearDestination({
      behavior: "tangent",
      destinationUrl: TICKET_URL,
      openInSidePanel,
      openExternal,
    });

    expect(openInSidePanel).toHaveBeenCalledExactlyOnceWith(TICKET_URL);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens tickets in the Linear desktop app when selected", async () => {
    const openInSidePanel = vi.fn();
    const openExternal = vi.fn();

    await openLinearDestination({
      behavior: "linear-app",
      destinationUrl: TICKET_URL,
      openInSidePanel,
      openExternal,
    });

    expect(openInSidePanel).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "linear://linear.app/tangent/issue/TAN-42/native-ticket-opening",
    );
  });

  it("opens Review in the Linear desktop app when selected", async () => {
    const openInSidePanel = vi.fn();
    const openExternal = vi.fn();

    await openLinearDestination({
      behavior: "linear-app",
      destinationUrl: REVIEW_URL,
      openInSidePanel,
      openExternal,
    });

    expect(openInSidePanel).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "linear://linear.review/bpdev97/tangent/pull/52",
    );
  });

  it("rejects untrusted destinations before invoking the desktop protocol", async () => {
    const openInSidePanel = vi.fn();
    const openExternal = vi.fn();

    await expect(
      openLinearDestination({
        behavior: "linear-app",
        destinationUrl: "https://example.com/bpdev97/tangent/pull/52",
        openInSidePanel,
        openExternal,
      }),
    ).rejects.toThrow("Linear returned an unsupported destination URL.");

    expect(openInSidePanel).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
