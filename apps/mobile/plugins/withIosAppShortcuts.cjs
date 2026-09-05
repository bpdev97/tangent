"use strict";

const { withAppDelegate } = require("expo/config-plugins");

const APP_SHORTCUTS_MARKER = "enum T3AppShortcutAction: String";
const APP_SHORTCUTS_SOURCE = String.raw`

enum T3AppShortcutAction: String {
  case newChat = "new-chat"
  case dictateNewChat = "dictate-new-chat"
}

enum T3AppShortcutActionStore {
  static let notification = Notification.Name("T3AppShortcutActionReceived")
  static let actionKey = "T3AppShortcutPendingAction"
  static let requestIdKey = "T3AppShortcutPendingRequestId"

  @MainActor
  static func submit(_ action: T3AppShortcutAction) {
    let requestId = UUID().uuidString
    let defaults = UserDefaults.standard
    defaults.set(action.rawValue, forKey: actionKey)
    defaults.set(requestId, forKey: requestIdKey)
    NotificationCenter.default.post(
      name: notification,
      object: nil,
      userInfo: ["action": action.rawValue, "requestId": requestId]
    )
  }
}

struct T3OpenNewChatIntent: AppIntent {
  static let title: LocalizedStringResource = "New Chat"
  static let description = IntentDescription("Open a new chat composer.")
  static var openAppWhenRun = true

  @available(iOS 26.0, *)
  static var supportedModes: IntentModes { .foreground(.immediate) }

  @MainActor
  func perform() async throws -> some IntentResult {
    T3AppShortcutActionStore.submit(.newChat)
    return .result()
  }
}

@available(iOS 26.0, *)
struct T3DictateNewChatIntent: AppIntent {
  static let title: LocalizedStringResource = "Dictate New Chat"
  static let description = IntentDescription("Open a new chat and start dictation.")
  static var supportedModes: IntentModes { .foreground(.immediate) }

  @MainActor
  func perform() async throws -> some IntentResult {
    T3AppShortcutActionStore.submit(.dictateNewChat)
    return .result()
  }
}

struct T3AppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: T3OpenNewChatIntent(),
      phrases: [
        "Start a new chat in \(.applicationName)",
        "Open a new chat in \(.applicationName)"
      ],
      shortTitle: "New Chat",
      systemImageName: "square.and.pencil"
    )

    if #available(iOS 26.0, *) {
      AppShortcut(
        intent: T3DictateNewChatIntent(),
        phrases: [
          "Dictate a new chat in \(.applicationName)",
          "Start voice chat in \(.applicationName)"
        ],
        shortTitle: "Dictate New Chat",
        systemImageName: "mic"
      )
    }
  }

  static var shortcutTileColor: ShortcutTileColor { .navy }
}
`;

function transformAppDelegate(contents) {
  let next = contents;
  if (!next.includes("import AppIntents")) {
    next = `import AppIntents\n${next}`;
  }
  if (!next.includes(APP_SHORTCUTS_MARKER)) {
    next += APP_SHORTCUTS_SOURCE;
  }
  return next;
}

function withIosAppShortcuts(config) {
  return withAppDelegate(config, (nextConfig) => {
    if (nextConfig.modResults.language !== "swift") {
      throw new Error("The iOS App Shortcuts plugin requires a Swift AppDelegate.");
    }
    nextConfig.modResults.contents = transformAppDelegate(nextConfig.modResults.contents);
    return nextConfig;
  });
}

module.exports = withIosAppShortcuts;
module.exports.transformAppDelegate = transformAppDelegate;
