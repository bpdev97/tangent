import * as NodeModule from "node:module";
import { describe, expect, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const plugin = require("./withIosAppShortcuts.cjs") as {
  readonly transformAppDelegate: (contents: string) => string;
};

describe("withIosAppShortcuts", () => {
  it("adds App Intents to a generated Swift app delegate exactly once", () => {
    const source = "internal import Expo\n\n@main\nclass AppDelegate: ExpoAppDelegate {}\n";
    const transformed = plugin.transformAppDelegate(source);

    expect(transformed).toContain("import AppIntents\ninternal import Expo");
    expect(transformed).toContain("struct T3OpenNewChatIntent: AppIntent");
    expect(transformed).toContain("struct T3DictateNewChatIntent: AppIntent");
    expect(plugin.transformAppDelegate(transformed)).toBe(transformed);
  });
});
