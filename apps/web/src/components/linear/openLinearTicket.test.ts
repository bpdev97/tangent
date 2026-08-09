import { describe, expect, it, vi } from "vite-plus/test";

import { openLinearTicket } from "./openLinearTicket";

const TICKET_URL = "https://linear.app/tangent/issue/TAN-42/native-ticket-opening";

describe("openLinearTicket", () => {
  it("opens tickets inside Tangent by default", async () => {
    const openInTangent = vi.fn();
    const openExternal = vi.fn();

    await openLinearTicket({
      behavior: "tangent",
      ticketUrl: TICKET_URL,
      openInTangent,
      openExternal,
    });

    expect(openInTangent).toHaveBeenCalledExactlyOnceWith(TICKET_URL);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens tickets in the Linear desktop app when selected", async () => {
    const openInTangent = vi.fn();
    const openExternal = vi.fn();

    await openLinearTicket({
      behavior: "linear-app",
      ticketUrl: TICKET_URL,
      openInTangent,
      openExternal,
    });

    expect(openInTangent).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      "linear://linear.app/tangent/issue/TAN-42/native-ticket-opening",
    );
  });
});
