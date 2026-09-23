/**
 * Buffer for a turn Hermes starts on its own (a background process, async
 * delegation, loop, or kanban notification) while no T3 run is active. The
 * adapter keeps the turn's frames here until the provider continuation run
 * attaches, then replays them into that run.
 *
 * @module provider/hermes/HermesBackgroundTurns
 */
import type { HermesGatewayEvent, HermesServerRequest } from "./HermesGatewayClient.ts";

/** Frames kept per background turn before streaming deltas are shed. */
const HERMES_BACKGROUND_BUFFER_LIMIT = 2_000;

const STREAM_DELTAS: ReadonlySet<string> = new Set([
  "message.delta",
  "thinking.delta",
  "reasoning.delta",
]);

/**
 * Never shed: turn boundaries, sealed text segments, and tool and subagent
 * results. `message.interim` and `message.complete` carry each segment's full
 * text, so the reply survives without its deltas.
 */
const ESSENTIAL_EVENTS: ReadonlySet<string> = new Set([
  "message.start",
  "message.interim",
  "message.complete",
  "tool.complete",
  "subagent.complete",
  "error",
]);

export type HermesBufferedItem =
  | { readonly kind: "event"; readonly event: HermesGatewayEvent }
  | { readonly kind: "request"; readonly request: HermesServerRequest };

export interface HermesBackgroundBuffer {
  readonly items: Array<HermesBufferedItem>;
  /** Deltas were shed; the replayed turn must prefer each segment's final text. */
  deltasDropped: boolean;
}

const isDroppable = (item: HermesBufferedItem) =>
  item.kind === "event" && !ESSENTIAL_EVENTS.has(item.event.type);

/**
 * Appends one frame, keeping the buffer bounded. Past the limit, every
 * streaming delta is shed (and later ones are not kept), then the oldest
 * progress frames go. Server requests and essential events are always kept.
 */
export function bufferHermesBackgroundItem(
  buffer: HermesBackgroundBuffer,
  item: HermesBufferedItem,
  limit = HERMES_BACKGROUND_BUFFER_LIMIT,
): void {
  if (item.kind === "event" && buffer.deltasDropped && STREAM_DELTAS.has(item.event.type)) return;
  buffer.items.push(item);
  if (buffer.items.length <= limit) return;
  if (!buffer.deltasDropped) {
    buffer.deltasDropped = true;
    let kept = 0;
    for (const entry of buffer.items) {
      if (entry.kind === "event" && STREAM_DELTAS.has(entry.event.type)) continue;
      buffer.items[kept++] = entry;
    }
    buffer.items.length = kept;
    if (buffer.items.length <= limit) return;
  }
  const oldest = buffer.items.findIndex(isDroppable);
  if (oldest !== -1) buffer.items.splice(oldest, 1);
}
