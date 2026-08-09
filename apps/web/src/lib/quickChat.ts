import { isGenericChatThread } from "@t3tools/shared/genericChat";

import type { LastGenericChatVisit } from "../uiStateStore";

interface QuickChatThreadLike {
  readonly environmentId: string;
  readonly id: string;
  readonly projectId: string;
  readonly archivedAt: string | null;
}

export type QuickChatTarget =
  | { readonly kind: "new" }
  | {
      readonly kind: "resume";
      readonly environmentId: string;
      readonly threadId: string;
    };

export function resolveQuickChatTarget(input: {
  readonly lastVisit: LastGenericChatVisit | null;
  readonly resumeMinutes: number | null;
  readonly threads: ReadonlyArray<QuickChatThreadLike>;
  readonly nowMs?: number;
}): QuickChatTarget {
  if (input.resumeMinutes === null || input.lastVisit === null) return { kind: "new" };

  const visitedAtMs = Date.parse(input.lastVisit.visitedAt);
  const ageMs = (input.nowMs ?? Date.now()) - visitedAtMs;
  if (!Number.isFinite(visitedAtMs) || ageMs < 0 || ageMs > input.resumeMinutes * 60_000) {
    return { kind: "new" };
  }

  const thread = input.threads.find(
    (candidate) =>
      candidate.environmentId === input.lastVisit?.environmentId &&
      candidate.id === input.lastVisit.threadId &&
      candidate.archivedAt === null &&
      isGenericChatThread(candidate),
  );
  return thread
    ? {
        kind: "resume",
        environmentId: thread.environmentId,
        threadId: thread.id,
      }
    : { kind: "new" };
}

export function focusVisibleChatComposer(): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="composer-editor"]')?.focus();
    });
  });
}
