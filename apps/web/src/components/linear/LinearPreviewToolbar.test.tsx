import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { LinearPreviewToolbar } from "./LinearPreviewToolbar";

describe("LinearPreviewToolbar", () => {
  it("shows Review and the linked ticket without generic browser chrome", () => {
    const markup = renderToStaticMarkup(
      <LinearPreviewToolbar
        currentUrl="https://linear.review/bpdev97/tangent/pull/52"
        presentation={{
          _tag: "linear",
          reviewUrl: "https://linear.review/bpdev97/tangent/pull/52",
          tickets: [
            {
              id: "issue-1",
              identifier: "TAN-42",
              title: "Make Linear feel native",
              url: "https://linear.app/tangent/issue/TAN-42",
            },
          ],
          ticketLookup: "ready",
        }}
        onNavigate={vi.fn()}
        onOpenTicket={vi.fn()}
      />,
    );

    expect(markup).toContain("Review");
    expect(markup).toContain("TAN-42");
    expect(markup).not.toContain("Search or enter URL");
    expect(markup).not.toContain("data-preview-url-input");
  });

  it("makes an empty resolved lookup explicit", () => {
    const markup = renderToStaticMarkup(
      <LinearPreviewToolbar
        currentUrl="https://linear.review/bpdev97/tangent/pull/52"
        presentation={{
          _tag: "linear",
          reviewUrl: "https://linear.review/bpdev97/tangent/pull/52",
          tickets: [],
          ticketLookup: "ready",
        }}
        onNavigate={vi.fn()}
        onOpenTicket={vi.fn()}
      />,
    );

    expect(markup).toContain("No linked ticket");
  });
});
