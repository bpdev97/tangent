/**
 * Hermes TUI-gateway frames for the adapter tests, baseline Hermes Agent
 * 0.21.4 (`v2026.9.21`, contract 7).
 *
 * `recorded` frames were captured from a real 0.21.4 gateway against a
 * disposable `HERMES_HOME` with no model credentials (session lifecycle,
 * self-description, error shapes). Paths, ids, and timestamps are scrubbed.
 * Model-turn frames cannot be recorded without credentials, so they are built
 * from the release's generated protocol types
 * (`apps/shared/src/gateway-contract.generated.ts`: `GatewayEventMap`,
 * `ServerRequestMap`) and `tui_gateway/server_requests.py`.
 */

export const HERMES_FIXTURE_CWD = "/workspace/project";
export const HERMES_FIXTURE_STORED_ID = "20260922_215902_5e030f";
export const HERMES_FIXTURE_LIVE_ID = "be7c8fa9";

export const recorded = {
  /** `session.create` result for a lazily built session. */
  sessionCreate: {
    session_id: HERMES_FIXTURE_LIVE_ID,
    stored_session_id: HERMES_FIXTURE_STORED_ID,
    message_count: 0,
    messages: [],
    info: {
      model: "claude-sonnet-5",
      provider: "anthropic",
      tools: {},
      skills: {},
      cwd: HERMES_FIXTURE_CWD,
      branch: "",
      project: null,
      lazy: true,
      desktop_contract: 7,
      profile_name: "default",
    },
  },
  /** `session.resume` result: a new live id, the durable key under `resumed`. */
  sessionResume: {
    session_id: "51d81662",
    resumed: HERMES_FIXTURE_STORED_ID,
    message_count: 1,
    messages: [{ role: "user", text: "hello", timestamp: 1790128767.127581, row_id: 1 }],
    messages_omitted: false,
    info: {
      cwd: HERMES_FIXTURE_CWD,
      branch: "",
      project: null,
      model: "claude-sonnet-5",
      tools: {},
      skills: {},
      lazy: true,
      desktop_contract: 7,
      profile_name: "default",
    },
    inflight: null,
    running: false,
    session_key: HERMES_FIXTURE_STORED_ID,
    started_at: 1790128772.93979,
    status: "idle",
  },
  /** `session.info` once the session's agent exists. */
  sessionInfo: {
    model: "claude-sonnet-5",
    provider: "anthropic",
    approval_mode: "smart",
    cwd: HERMES_FIXTURE_CWD,
    running: false,
    stored_session_id: HERMES_FIXTURE_STORED_ID,
    desktop_contract: 7,
    version: "0.21.4",
    release_date: "2026.9.21",
    update_behind: 0,
    update_command: "hermes update",
    usage: {},
    profile_name: "default",
  },
  promptSubmit: { status: "streaming" },
  clientCapabilities: {
    server_requests: [
      "approval",
      "clarify",
      "preview.act",
      "preview.read",
      "secret",
      "sudo",
      "terminal.read",
      "tour",
      "vault.code",
      "vault.save_login",
      "vault.unlock_prompt",
      "window.read",
    ],
  },
  setupStatusUnconfigured: {
    provider_configured: false,
    ready: true,
    free_tier: false,
    other_providers: false,
    inference_provider: "",
  },
  sessionNotFound: { code: 4007, message: "session not found" },
  steerUnsupported: { code: 4010, message: "agent does not support steer" },
} as const;

/** One normal turn: reasoning, streamed text, final usage. */
export const normalTurn = [
  { type: "message.start", payload: {} },
  { type: "reasoning.delta", payload: { text: "The user wants a greeting." } },
  { type: "message.delta", payload: { text: "Hello" } },
  { type: "message.delta", payload: { text: " from Hermes." } },
  {
    type: "session.usage",
    payload: { usage: { context_used: 1200, context_max: 200000, input: 1100, output: 100 } },
  },
  {
    type: "message.complete",
    payload: {
      text: "Hello from Hermes.",
      status: "complete",
      usage: {
        context_used: 1250,
        context_max: 200000,
        input: 1100,
        output: 150,
        cache_read: 800,
      },
    },
  },
] as const;

/** Interim commentary beside a tool call, then a previewed final answer. */
export const toolTurn = [
  { type: "message.start", payload: {} },
  { type: "message.delta", payload: { text: "Let me check the tests." } },
  { type: "message.interim", payload: { text: "Let me check the tests.", already_streamed: true } },
  {
    type: "tool.start",
    payload: {
      tool_id: "call_1",
      name: "terminal",
      context: "vp test run",
      args: { command: "vp test run" },
    },
  },
  {
    type: "tool.complete",
    payload: {
      tool_id: "call_1",
      name: "terminal",
      duration_s: 1.2,
      result: { output: "12 passed", exit_code: 0 },
      summary: "12 passed",
    },
  },
  {
    type: "message.complete",
    payload: {
      text: "Let me check the tests.\n\nAll 12 tests pass.",
      status: "complete",
      response_previewed: true,
      usage: {},
    },
  },
] as const;

export const subagentEvents = [
  {
    type: "subagent.spawn_requested",
    payload: { goal: "Audit the parser", task_count: 1, task_index: 0, subagent_id: "sa_1" },
  },
  {
    type: "subagent.start",
    payload: {
      goal: "Audit the parser",
      task_count: 1,
      task_index: 0,
      subagent_id: "sa_1",
      model: "claude-sonnet-5",
    },
  },
  {
    type: "subagent.tool",
    payload: {
      goal: "Audit the parser",
      task_count: 1,
      task_index: 0,
      subagent_id: "sa_1",
      tool_name: "read_file",
    },
  },
  {
    type: "subagent.complete",
    payload: {
      goal: "Audit the parser",
      task_count: 1,
      task_index: 0,
      subagent_id: "sa_1",
      status: "completed",
      summary: "No issues found.",
    },
  },
] as const;

/** Server→client request params (`srq-…` frames). */
export const serverRequests = {
  approval: {
    request_id: "appr_1",
    command: "rm -rf build",
    description: "Delete the build directory",
    tool_name: "terminal",
    allow_session: true,
    allow_permanent: true,
  },
  batchClarify: {
    questions: [
      { qid: "q1", question: "Which package manager?", choices: ["pnpm", "npm (Recommended)"] },
      {
        qid: "q2",
        question: "Which targets?",
        choices: ["web", "mobile", "desktop"],
        multi_select: true,
      },
      { qid: "q3", question: "Anything else?" },
    ],
  },
  sudo: { command: "apt install jq" },
  secret: { env_var: "OPENROUTER_API_KEY", prompt: "Paste your OpenRouter key" },
} as const;
