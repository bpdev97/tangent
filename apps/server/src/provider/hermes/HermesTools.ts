/**
 * Normalizes Hermes `tool.start` / `tool.complete` payloads into the shared
 * v2 tool shapes (commands, changed paths, searches, URLs, prompts, MCP
 * identities, delegated tasks). Raw arguments are kept only for MCP calls,
 * whose expanded view needs them; other tools carry bounded display fields
 * rather than file contents or typed browser input.
 *
 * @module provider/hermes/HermesTools
 */
import { record, text } from "./HermesGatewaySupport.ts";

const MAX_TOOL_OUTPUT_CHARS = 20_000;

export type HermesToolItem =
  | {
      readonly type: "command_execution";
      readonly input: string;
      readonly output?: string;
      readonly exitCode?: number;
    }
  | {
      readonly type: "file_change";
      readonly fileName: string;
      readonly diffStr?: string;
      readonly changes?: ReadonlyArray<{ readonly operation: string; readonly path: string }>;
    }
  | { readonly type: "file_search"; readonly pattern?: string }
  | { readonly type: "web_search"; readonly patterns?: ReadonlyArray<string> }
  | {
      readonly type: "dynamic_tool";
      readonly toolName: string | null;
      readonly input: unknown;
      readonly output?: unknown;
    };

export interface HermesToolProjection {
  readonly title: string;
  readonly item: HermesToolItem;
  readonly failed: boolean;
}

function bounded(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length > MAX_TOOL_OUTPUT_CHARS ? value.slice(0, MAX_TOOL_OUTPUT_CHARS) : value;
}

function firstText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return text(value);
  for (const entry of value) {
    const candidate = text(entry);
    if (candidate) return candidate;
  }
  return undefined;
}

function mcpToolIdentity(
  name: string | undefined,
): { readonly server: string; readonly tool: string } | undefined {
  const match = /^mcp__(.+?)__(.+)$/u.exec(name ?? "");
  return match?.[1] && match[2] ? { server: match[1], tool: match[2] } : undefined;
}

function humanize(name: string): string {
  return name
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

type ToolKind = "command" | "file_change" | "file_search" | "web_search" | "mcp" | "other";

function toolKind(name: string): ToolKind {
  const normalized = name.toLowerCase();
  if (mcpToolIdentity(name)) return "mcp";
  if (normalized === "search_files") return "file_search";
  if (normalized === "web_search" || normalized === "x_search") return "web_search";
  if (
    normalized === "terminal" ||
    normalized === "execute_code" ||
    normalized.includes("shell") ||
    normalized === "exec"
  ) {
    return "command";
  }
  if (normalized === "write_file" || normalized === "patch" || normalized.includes("edit")) {
    return "file_change";
  }
  return "other";
}

const TOOL_TITLES: Readonly<Record<string, string>> = {
  search_files: "Grep",
  read_file: "Read File",
  write_file: "Write File",
  patch: "Patch",
  web_extract: "Read Page",
  web_search: "Web Search",
  session_search: "Search Sessions",
  image_generate: "Generate Image",
  vision_analyze: "Image View",
  delegate_task: "Subagent Task",
  terminal: "Ran command",
};

function toolTitle(name: string): string {
  const mcp = mcpToolIdentity(name);
  if (mcp) return `${mcp.server} · ${mcp.tool}`;
  return TOOL_TITLES[name.toLowerCase()] ?? humanize(name);
}

function patchFilePaths(value: unknown): ReadonlyArray<{ operation: string; path: string }> {
  const patch = text(value);
  if (!patch) return [];
  return [...patch.matchAll(/^\*\*\* (Add|Delete|Update) File:\s*(.+)$/gmu)].flatMap((match) => {
    const path = match[2]?.trim();
    return path ? [{ operation: (match[1] ?? "update").toLowerCase(), path }] : [];
  });
}

/** Bounded, human-facing fields for tools whose raw arguments are not kept. */
function displayInput(
  name: string,
  args: Readonly<Record<string, unknown>>,
  context: string | undefined,
): Readonly<Record<string, unknown>> {
  const field = (key: string, value: string | undefined) => (value ? { [key]: value } : {});
  switch (name.toLowerCase()) {
    case "session_search":
      return field("query", text(args.query));
    case "web_extract":
      return field("url", firstText(args.urls) ?? text(args.url));
    case "browser_navigate":
      return field("url", text(args.url));
    case "read_file":
      return field("path", text(args.path));
    case "vision_analyze":
      return field("question", text(args.question));
    case "image_generate":
    case "video_generate":
      return field("prompt", text(args.prompt));
    case "delegate_task": {
      const tasks = Array.isArray(args.tasks)
        ? args.tasks.flatMap((task) => {
            const goal = text(record(task).goal);
            return goal ? [goal] : [];
          })
        : [];
      return {
        ...field("goal", text(args.goal)),
        ...(tasks.length > 0 ? { tasks } : {}),
      };
    }
    default:
      return field("summary", context);
  }
}

function resultOutput(payload: Readonly<Record<string, unknown>>): string | undefined {
  const result = record(payload.result);
  return bounded(
    text(result.output) ??
      text(payload.result_text) ??
      (typeof payload.result === "string" ? text(payload.result) : undefined) ??
      text(payload.summary),
  );
}

/**
 * `start` is the matching `tool.start` payload, so a completion that omits
 * arguments still renders with them.
 */
export function projectHermesTool(
  payload: Readonly<Record<string, unknown>>,
  start?: Readonly<Record<string, unknown>>,
): HermesToolProjection {
  const name = text(payload.name) ?? text(start?.name) ?? "tool";
  const args = { ...record(start?.args), ...record(payload.args) };
  const context = text(payload.context) ?? text(start?.context);
  const completed = payload.result !== undefined || payload.result_text !== undefined;
  const error = text(payload.error) ?? text(record(payload.result).error);
  const output = completed ? resultOutput(payload) : undefined;
  const title = toolTitle(name);
  const kind = toolKind(name);

  const item = ((): HermesToolItem => {
    switch (kind) {
      case "command": {
        const exitCode = record(payload.result).exit_code;
        return {
          type: "command_execution",
          input: text(args.command) ?? text(args.cmd) ?? text(args.code) ?? context ?? name,
          ...(output ? { output } : {}),
          ...(typeof exitCode === "number" && Number.isInteger(exitCode) ? { exitCode } : {}),
        };
      }
      case "file_change": {
        const changes = [
          ...(text(args.path) ? [{ operation: "update", path: text(args.path)! }] : []),
          ...patchFilePaths(args.patch),
        ];
        const fileName = changes[0]?.path;
        if (fileName) {
          const diff = bounded(text(payload.inline_diff));
          return {
            type: "file_change",
            fileName,
            ...(diff ? { diffStr: diff } : {}),
            ...(changes.length > 1 ? { changes } : {}),
          };
        }
        break;
      }
      case "file_search": {
        const pattern = text(args.pattern);
        return { type: "file_search", ...(pattern ? { pattern } : {}) };
      }
      case "web_search":
        return {
          type: "web_search",
          ...(text(args.query) ? { patterns: [text(args.query)!] } : {}),
        };
      case "mcp":
        return {
          type: "dynamic_tool",
          toolName: name,
          input: args,
          ...(payload.result !== undefined ? { output: payload.result } : {}),
        };
      case "other":
        break;
    }
    return {
      type: "dynamic_tool",
      toolName: name,
      input: displayInput(name, args, context),
      ...(output ? { output } : {}),
    };
  })();

  return { title, item, failed: error !== undefined };
}
