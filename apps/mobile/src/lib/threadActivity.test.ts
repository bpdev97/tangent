import { describe, expect, it } from "vite-plus/test";

import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

import {
  buildThreadFeed,
  derivePendingApprovals,
  deriveThreadFeedPresentation,
  type ThreadFeedActivity,
  type ThreadFeedEntry,
} from "./threadActivity";

describe("derivePendingApprovals", () => {
  it("derives MCP tool approvals with persistence capabilities", () => {
    const activities = [
      makeActivity({
        id: EventId.make("approval-open-mcp-tool"),
        createdAt: "2026-04-01T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Computer-use approval requested",
        tone: "approval",
        payload: {
          requestId: "req-mcp-tool",
          requestKind: "mcp-tool-call",
          detail: "Use computer tool preview_open?",
          supportsSessionPersistence: true,
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-mcp-tool",
        requestKind: "mcp-tool-call",
        createdAt: "2026-04-01T00:00:01.000Z",
        detail: "Use computer tool preview_open?",
        supportsSessionPersistence: true,
      },
    ]);
  });
});

function makeActivity(
  input: Partial<OrchestrationThreadActivity> &
    Pick<OrchestrationThreadActivity, "id" | "kind" | "summary" | "createdAt">,
): OrchestrationThreadActivity {
  return {
    tone: "info",
    payload: {},
    turnId: null,
    ...input,
  };
}

function makeThread(
  input: Partial<OrchestrationThread> & Pick<OrchestrationThread, "id" | "projectId" | "title">,
): OrchestrationThread {
  return {
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...input,
    settledOverride: input.settledOverride ?? null,
    settledAt: input.settledAt ?? null,
  };
}

describe("buildThreadFeed", () => {
  it("renders a collapsed subagent lifecycle with mobile agent presentation", () => {
    const turnId = TurnId.make("turn-agent-1");
    const basePayload = {
      itemType: "collab_agent_tool_call",
      itemId: "agent-1",
      agentId: "agent-1",
      title: "explore subagent",
      data: {
        agentId: "agent-1",
        role: "explore",
        prompt: "Inspect the mobile feed",
        model: "fast",
      },
    };
    const thread = makeThread({
      id: ThreadId.make("thread-mobile-agent"),
      projectId: ProjectId.make("project-1"),
      title: "Mobile subagent",
      activities: [
        makeActivity({
          id: EventId.make("agent-started"),
          kind: "agent.started",
          tone: "tool",
          summary: "explore subagent started",
          createdAt: "2026-04-01T00:00:01.000Z",
          turnId,
          payload: { ...basePayload, status: "inProgress" },
        }),
        makeActivity({
          id: EventId.make("agent-completed"),
          kind: "agent.completed",
          tone: "tool",
          summary: "explore subagent completed",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId,
          payload: {
            ...basePayload,
            status: "completed",
            detail: "Mobile feed verified",
            data: { ...basePayload.data, summary: "Mobile feed verified" },
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      type: "activity-group",
      activities: [
        {
          id: "agent-completed",
          icon: "agent",
          status: "success",
          toolLike: true,
          toolCall: {
            callId: "agent-1",
            category: "agent",
            title: "explore subagent",
            status: "completed",
            preview: "Mobile feed verified",
          },
        },
      ],
    });
  });

  it("keeps historic work entries attributed to their turns", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Runtime warning thread",
      latestTurn: {
        turnId: TurnId.make("turn-latest"),
        state: "running",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("activity-old"),
          kind: "runtime.warning",
          summary: "Runtime warning",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId: TurnId.make("turn-old"),
          payload: {
            message: "Old warning",
          },
        }),
        makeActivity({
          id: EventId.make("activity-latest"),
          kind: "runtime.warning",
          summary: "Runtime warning",
          createdAt: "2026-04-01T00:00:03.000Z",
          turnId: TurnId.make("turn-latest"),
          payload: {
            message: "Latest warning",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    expect(feed).toMatchObject([
      {
        type: "activity-group",
        turnId: "turn-old",
        activities: [{ id: "activity-old", turnId: "turn-old" }],
      },
      {
        type: "activity-group",
        turnId: "turn-latest",
        activities: [{ id: "activity-latest", turnId: "turn-latest" }],
      },
    ]);
  });

  it("collapses matching tool lifecycle rows like desktop", () => {
    const thread = makeThread({
      id: ThreadId.make("thread-2"),
      projectId: ProjectId.make("project-1"),
      title: "Collapsed tools",
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:03.000Z",
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("tool-updated"),
          kind: "tool.updated",
          tone: "tool",
          summary: "Run tests",
          createdAt: "2026-04-01T00:00:01.000Z",
          turnId: TurnId.make("turn-1"),
          payload: {
            title: "Run tests",
            itemType: "command_execution",
            detail: "/bin/zsh -lc 'bun run test'",
          },
        }),
        makeActivity({
          id: EventId.make("tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Run tests completed",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId: TurnId.make("turn-1"),
          payload: {
            title: "Run tests",
            itemType: "command_execution",
            detail: "/bin/zsh -lc 'bun run test'",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const group = feed[0];

    expect(group).toMatchObject({
      type: "activity-group",
    });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities).toMatchObject([
      {
        id: "tool-completed",
        createdAt: "2026-04-01T00:00:02.000Z",
        turnId: "turn-1",
        summary: "Run tests",
        detail: "bun run test",
        fullDetail: "Run tests\n\nCommand\nbun run test\n\nInvocation\n/bin/zsh -lc 'bun run test'",
        icon: "command",
        toolLike: true,
        status: "success",
        toolCall: {
          category: "command",
          status: "completed",
          sections: [
            { kind: "code", title: "Command", content: "bun run test" },
            {
              kind: "code",
              title: "Invocation",
              content: "/bin/zsh -lc 'bun run test'",
            },
          ],
        },
      },
    ]);
    expect(group.activities[0]?.copyText).toBe(
      "Run tests\n\nCommand\nbun run test\n\nInvocation\n/bin/zsh -lc 'bun run test'",
    );
  });

  it("keeps a Codex command start visible while the command is running", () => {
    const turnId = TurnId.make("turn-live-command");
    const thread = makeThread({
      id: ThreadId.make("thread-live-command"),
      projectId: ProjectId.make("project-1"),
      title: "Live command",
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("command-start"),
          kind: "tool.started",
          tone: "tool",
          summary: "Ran command started",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId,
          payload: {
            itemId: "command-1",
            itemType: "command_execution",
            status: "inProgress",
            title: "Ran command",
            data: {
              item: {
                id: "command-1",
                command: "python3 slow-script.py",
                status: "inProgress",
              },
            },
          },
        }),
      ],
    });

    const feed = deriveThreadFeedPresentation(
      buildThreadFeed(thread),
      thread.latestTurn,
      new Set(),
    );
    expect(feed).toMatchObject([
      {
        type: "activity-group",
        activities: [
          {
            id: "command-start",
            summary: "Running command",
            detail: "python3 slow-script.py",
            status: "neutral",
            toolCall: {
              title: "Running command",
              status: "inProgress",
            },
          },
        ],
      },
    ]);
  });

  it("keeps MCP inputs available to expanded mobile work rows", () => {
    const turnId = TurnId.make("turn-mcp");
    const thread = makeThread({
      id: ThreadId.make("thread-mcp"),
      projectId: ProjectId.make("project-1"),
      title: "Expandable MCP call",
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:03.000Z",
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("mcp-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Call repository tool",
          createdAt: "2026-04-01T00:00:02.000Z",
          turnId,
          payload: {
            title: "Call repository tool",
            itemType: "mcp_tool_call",
            detail: "repository.search",
            status: "completed",
            data: {
              item: {
                server: "repository",
                tool: "search",
                arguments: { query: "work log" },
              },
            },
          },
        }),
      ],
    });

    const group = buildThreadFeed(thread)[0];
    expect(group).toMatchObject({ type: "activity-group" });
    if (!group || group.type !== "activity-group") {
      return;
    }

    expect(group.activities[0]?.icon).toBe("wrench");
    expect(group.activities[0]?.fullDetail).toContain('"query": "work log"');
    expect(group.activities[0]?.fullDetail).toContain("repository.search");
  });

  it("folds settled turn work while leaving the terminal answer visible", () => {
    const turnId = TurnId.make("turn-1");
    const thread = makeThread({
      id: ThreadId.make("thread-3"),
      projectId: ProjectId.make("project-1"),
      title: "Folded work",
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: "2026-04-01T00:00:18.000Z",
        assistantMessageId: MessageId.make("assistant-final"),
      },
      messages: [
        {
          id: MessageId.make("assistant-commentary"),
          role: "assistant",
          text: "I am checking.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:02.000Z",
          updatedAt: "2026-04-01T00:00:03.000Z",
        },
        {
          id: MessageId.make("assistant-final"),
          role: "assistant",
          text: "Done.",
          turnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:17.000Z",
          updatedAt: "2026-04-01T00:00:18.000Z",
        },
      ],
      activities: [
        makeActivity({
          id: EventId.make("tool-completed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Read files",
          createdAt: "2026-04-01T00:00:05.000Z",
          turnId,
          payload: {
            title: "Read files",
            itemType: "file_read",
            status: "completed",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const collapsed = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set());
    expect(collapsed.map((entry) => entry.id)).toEqual([
      "turn-fold:response:prelude:turn-1",
      "assistant-final",
    ]);
    expect(collapsed[0]).toMatchObject({
      type: "turn-fold",
      label: "Worked for 17s",
      expanded: false,
    });

    const expanded = deriveThreadFeedPresentation(
      feed,
      thread.latestTurn,
      new Set(["response:prelude:turn-1"]),
    );
    expect(expanded.map((entry) => entry.id)).toEqual([
      "turn-fold:response:prelude:turn-1",
      "assistant-commentary",
      "tool-completed",
      "assistant-final",
    ]);
  });

  it("keeps follow-up answers separate when they share a provider turn", () => {
    const turnId = TurnId.make("turn-steered");
    const message = (
      id: string,
      role: "user" | "assistant",
      text: string,
      createdAt: string,
    ): OrchestrationThread["messages"][number] => ({
      id: MessageId.make(id),
      role,
      text,
      turnId: role === "assistant" ? turnId : null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    });
    const thread = makeThread({
      id: ThreadId.make("thread-steered-responses"),
      projectId: ProjectId.make("project-1"),
      title: "Steered responses",
      latestTurn: {
        turnId,
        state: "completed",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:00.000Z",
        completedAt: "2026-04-01T00:00:07.000Z",
        assistantMessageId: MessageId.make("answer-2"),
      },
      messages: [
        message("user-1", "user", "First question", "2026-04-01T00:00:00.000Z"),
        message("commentary-1", "assistant", "Checking first", "2026-04-01T00:00:01.000Z"),
        message("answer-1", "assistant", "First answer", "2026-04-01T00:00:02.000Z"),
        message("user-2", "user", "Follow-up", "2026-04-01T00:00:04.000Z"),
        message("commentary-2", "assistant", "Checking next", "2026-04-01T00:00:05.000Z"),
        message("answer-2", "assistant", "Follow-up answer", "2026-04-01T00:00:06.000Z"),
      ],
    });

    const presented = deriveThreadFeedPresentation(
      buildThreadFeed(thread),
      thread.latestTurn,
      new Set(),
    );

    expect(presented.map((entry) => entry.id)).toEqual([
      "user-1",
      "turn-fold:response:user-1",
      "answer-1",
      "user-2",
      "turn-fold:response:user-2",
      "answer-2",
    ]);
  });

  for (const [threadKind, projectId] of [
    ["generic Chat", "t3code-generic-chat"],
    ["project thread", "project-1"],
  ] as const) {
    it(`keeps one response when a user send spans multiple provider turns in a ${threadKind}`, () => {
      const firstTurnId = TurnId.make("turn-1");
      const secondTurnId = TurnId.make("turn-2");
      const thread = makeThread({
        id: ThreadId.make(`thread-${projectId}-multi-turn-response`),
        projectId: ProjectId.make(projectId),
        title: "Multi-turn response",
        latestTurn: {
          turnId: secondTurnId,
          state: "completed",
          requestedAt: "2026-04-01T00:00:02.000Z",
          startedAt: "2026-04-01T00:00:02.000Z",
          completedAt: "2026-04-01T00:00:06.000Z",
          assistantMessageId: MessageId.make("answer-2"),
        },
        messages: [
          {
            id: MessageId.make("user-1"),
            role: "user",
            text: "What did we decide?",
            turnId: null,
            streaming: false,
            createdAt: "2026-04-01T00:00:00.000Z",
            updatedAt: "2026-04-01T00:00:00.000Z",
          },
          {
            id: MessageId.make("commentary-1"),
            role: "assistant",
            text: "Checking earlier context.",
            turnId: firstTurnId,
            streaming: false,
            createdAt: "2026-04-01T00:00:01.000Z",
            updatedAt: "2026-04-01T00:00:01.000Z",
          },
          {
            id: MessageId.make("answer-2"),
            role: "assistant",
            text: "Here is the answer.",
            turnId: secondTurnId,
            streaming: false,
            createdAt: "2026-04-01T00:00:05.000Z",
            updatedAt: "2026-04-01T00:00:06.000Z",
          },
        ],
        activities: [
          makeActivity({
            id: EventId.make("work-2"),
            kind: "tool.completed",
            tone: "tool",
            summary: "Looked up context",
            createdAt: "2026-04-01T00:00:03.000Z",
            turnId: secondTurnId,
            payload: {
              title: "Looked up context",
              itemType: "file_read",
              status: "completed",
            },
          }),
        ],
      });

      const presented = deriveThreadFeedPresentation(
        buildThreadFeed(thread),
        thread.latestTurn,
        new Set(),
      );

      expect(presented.map((entry) => entry.id)).toEqual([
        "user-1",
        "turn-fold:response:user-1",
        "answer-2",
      ]);
      expect(presented.filter((entry) => entry.type === "turn-fold")).toHaveLength(1);
    });
  }

  it("measures a steer-superseded turn from its user boundary through trailing work", () => {
    const firstTurnId = TurnId.make("turn-1");
    const secondTurnId = TurnId.make("turn-2");
    const thread = makeThread({
      id: ThreadId.make("thread-steered"),
      projectId: ProjectId.make("project-1"),
      title: "Steered work",
      latestTurn: {
        turnId: secondTurnId,
        state: "running",
        requestedAt: "2026-04-01T00:00:14.000Z",
        startedAt: "2026-04-01T00:00:14.000Z",
        completedAt: null,
        assistantMessageId: MessageId.make("assistant-next"),
      },
      messages: [
        {
          id: MessageId.make("user-1"),
          role: "user",
          text: "Do it once more.",
          turnId: null,
          streaming: false,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        {
          id: MessageId.make("assistant-commentary"),
          role: "assistant",
          text: "Kicking off call 1.",
          turnId: firstTurnId,
          streaming: false,
          createdAt: "2026-04-01T00:00:09.000Z",
          updatedAt: "2026-04-01T00:00:09.000Z",
        },
        {
          id: MessageId.make("user-2"),
          role: "user",
          text: "Actually do 15.",
          turnId: null,
          streaming: false,
          createdAt: "2026-04-01T00:00:14.000Z",
          updatedAt: "2026-04-01T00:00:14.000Z",
        },
        {
          id: MessageId.make("assistant-next"),
          role: "assistant",
          text: "One down - adjusting.",
          turnId: secondTurnId,
          streaming: true,
          createdAt: "2026-04-01T00:00:17.000Z",
          updatedAt: "2026-04-01T00:00:17.000Z",
        },
      ],
      activities: [
        makeActivity({
          id: EventId.make("work-1"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Ran command",
          createdAt: "2026-04-01T00:00:12.000Z",
          turnId: firstTurnId,
          payload: {
            title: "Ran command",
            itemType: "command_execution",
            status: "completed",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    const collapsed = deriveThreadFeedPresentation(feed, thread.latestTurn, new Set());
    expect(collapsed.find((entry) => entry.type === "turn-fold")).toMatchObject({
      turnId: firstTurnId,
      label: "Worked for 12s",
    });
  });

  it("keeps an active turn expanded and classifies error-shaped tool output", () => {
    const turnId = TurnId.make("turn-running");
    const thread = makeThread({
      id: ThreadId.make("thread-4"),
      projectId: ProjectId.make("project-1"),
      title: "Running work",
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: "2026-04-01T00:00:00.000Z",
        startedAt: "2026-04-01T00:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      activities: [
        makeActivity({
          id: EventId.make("tool-failed"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Run command",
          createdAt: "2026-04-01T00:00:05.000Z",
          turnId,
          payload: {
            title: "Run command",
            itemType: "command_execution",
            detail: "zsh: command not found: nope",
            status: "completed",
          },
        }),
      ],
    });

    const feed = buildThreadFeed(thread);
    expect(deriveThreadFeedPresentation(feed, thread.latestTurn, new Set())).toEqual(feed);
    expect(feed[0]).toMatchObject({
      type: "activity-group",
      activities: [{ status: "failure" }],
    });
  });

  it("appends active work as a normal timeline row", () => {
    const startedAt = "2026-04-01T00:00:01.000Z";
    const presented = deriveThreadFeedPresentation([], null, new Set(), new Set(), startedAt);

    expect(presented).toEqual([
      {
        type: "working",
        id: "working-indicator-row",
        createdAt: startedAt,
      },
    ]);
    expect(deriveThreadFeedPresentation(presented, null, new Set())).toEqual([]);
  });

  it("models work-log overflow as list rows", () => {
    const activity = (
      id: string,
      createdAt: string,
      status: ThreadFeedActivity["status"] = "success",
    ): ThreadFeedActivity => ({
      id,
      createdAt,
      turnId: null,
      summary: `Tool ${id}`,
      detail: null,
      fullDetail: null,
      copyText: id,
      icon: "command",
      toolLike: true,
      status,
    });
    const feed: ThreadFeedEntry[] = [
      {
        type: "activity-group",
        id: "work-group-1",
        createdAt: "2026-04-01T00:00:01.000Z",
        turnId: null,
        activities: [
          activity("activity-1", "2026-04-01T00:00:01.000Z"),
          activity("activity-neutral", "2026-04-01T00:00:02.000Z", "neutral"),
          activity("activity-2", "2026-04-01T00:00:03.000Z"),
          activity("activity-3", "2026-04-01T00:00:04.000Z"),
          activity("activity-4", "2026-04-01T00:00:05.000Z"),
          activity("activity-5", "2026-04-01T00:00:06.000Z"),
        ],
      },
    ];

    const collapsed = deriveThreadFeedPresentation(feed, null, new Set());
    expect(collapsed.map((entry) => entry.id)).toEqual([
      "activity-3",
      "activity-4",
      "activity-5",
      "work-toggle:work-group-1",
    ]);
    expect(collapsed[3]).toMatchObject({
      type: "work-toggle",
      groupId: "work-group-1",
      hiddenCount: 2,
      expanded: false,
    });

    const expanded = deriveThreadFeedPresentation(feed, null, new Set(), new Set(["work-group-1"]));
    expect(expanded.map((entry) => entry.id)).toEqual([
      "activity-1",
      "activity-2",
      "activity-3",
      "activity-4",
      "activity-5",
      "work-toggle:work-group-1",
    ]);
    expect(expanded.at(-1)).toMatchObject({
      type: "work-toggle",
      expanded: true,
    });
  });
});
