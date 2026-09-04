import { EnvironmentId, ThreadId, type LinearPrDestinationResolution } from "@t3tools/contracts";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("../../hooks/useSettings", () => {
  const linear = {
    apiKeyRedacted: true,
    reviewRepositories: [],
    prBadgeBehavior: "choose",
    ticketOpenBehavior: "tangent",
  };
  return { useEnvironmentSettings: () => linear };
});
vi.mock("../../lib/openPullRequestLink", () => ({ useOpenPrLink: () => vi.fn() }));
vi.mock("../../state/server", () => ({
  serverEnvironment: { resolveLinearPrDestinations: "resolve" },
}));
vi.mock("../../state/preview", () => ({ previewEnvironment: { open: "preview" } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => lookup }));
vi.mock("../ui/menu", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return Object.fromEntries(
    [
      "Menu",
      "MenuGroup",
      "MenuGroupLabel",
      "MenuItem",
      "MenuPopup",
      "MenuSeparator",
      "MenuTrigger",
    ].map((name) => [name, Container]),
  );
});

import { Menu } from "../ui/menu";
import { LinearPrBadge } from "./LinearPrBadge";

let renderer: ReactTestRenderer;
const props: ComponentProps<typeof LinearPrBadge> = {
  pr: {
    number: 67,
    url: "https://github.com/bpdev97/tangent/pull/67",
    title: "Sync",
    state: "open",
    baseRef: "main",
    headRef: "sync/upstream",
  },
  status: {
    label: "67",
    colorClass: "",
    tooltip: "PR 67",
    tooltipLead: "",
    tooltipTitle: "Sync",
    url: "https://github.com/bpdev97/tangent/pull/67",
  },
  threadRef: { environmentId: EnvironmentId.make("local"), threadId: ThreadId.make("thread") },
  openPullRequestsInRightPanel: false,
  onThreadActivate: vi.fn(),
};
function result(identifier: string) {
  return {
    _tag: "Success",
    value: {
      status: "resolved",
      stale: false,
      review: null,
      tickets: [
        {
          id: identifier,
          identifier,
          title: identifier,
          url: `https://linear.app/test/issue/${identifier}`,
        },
      ],
    } satisfies LinearPrDestinationResolution,
  };
}
const text = () => JSON.stringify(renderer.toJSON());
async function openMenu(open: boolean) {
  await act(() => renderer.root.findAllByType(Menu)[0]!.props.onOpenChange(open));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  lookup.mockReset();
  await act(() => {
    renderer = create(<LinearPrBadge {...props} />);
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("Linear destination freshness", () => {
  it("replaces a cached ticket when the menu is reopened", async () => {
    lookup.mockResolvedValueOnce(result("TAN-1")).mockResolvedValueOnce(result("TAN-2"));
    await openMenu(true);
    expect(text()).toContain("TAN-1");
    await openMenu(false);
    await openMenu(true);
    expect(text()).toContain("TAN-2");
    expect(text()).not.toContain("TAN-1");
  });

  it("ignores a late response from a previous environment", async () => {
    let finishPrevious: (value: ReturnType<typeof result>) => void = () => {
      throw new Error("Lookup has not started");
    };
    const previous = new Promise<ReturnType<typeof result>>((resolve) => {
      finishPrevious = resolve;
    });
    lookup.mockReturnValueOnce(previous).mockResolvedValueOnce(result("TAN-2"));
    await openMenu(true);
    await act(() =>
      renderer.update(
        <LinearPrBadge
          {...props}
          threadRef={{ ...props.threadRef, environmentId: EnvironmentId.make("remote") }}
        />,
      ),
    );
    await openMenu(true);
    await act(() => finishPrevious(result("TAN-1")));
    expect(text()).toContain("TAN-2");
    expect(text()).not.toContain("TAN-1");
  });
});
