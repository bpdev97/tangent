import { assert, describe, it } from "@effect/vitest";

import { isQuickChatActionUrl, resolveQuickChatActionScheme } from "./DesktopQuickChat.ts";

describe("DesktopQuickChat", () => {
  it("uses dedicated production and development schemes", () => {
    assert.equal(resolveQuickChatActionScheme(false), "bpdev-code-action");
    assert.equal(resolveQuickChatActionScheme(true), "bpdev-code-dev-action");
  });

  it("accepts only the fixed quick-chat action", () => {
    assert.isTrue(isQuickChatActionUrl("bpdev-code-action://quick-chat", "bpdev-code-action"));
    assert.isFalse(isQuickChatActionUrl("bpdev-code://quick-chat", "bpdev-code-action"));
    assert.isFalse(isQuickChatActionUrl("bpdev-code-action://settings", "bpdev-code-action"));
    assert.isFalse(
      isQuickChatActionUrl("bpdev-code-action://quick-chat?next=settings", "bpdev-code-action"),
    );
  });
});
