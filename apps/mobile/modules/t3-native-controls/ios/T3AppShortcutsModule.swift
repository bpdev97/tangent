import ExpoModulesCore
import Foundation

public final class T3AppShortcutsModule: Module {
  private static let notification = Notification.Name("T3AppShortcutActionReceived")
  private static let actionKey = "T3AppShortcutPendingAction"
  private static let requestIdKey = "T3AppShortcutPendingRequestId"

  public func definition() -> ModuleDefinition {
    Name("T3AppShortcuts")
    Events("onShortcutAction")

    Function("getPendingShortcutAction") {
      self.pendingShortcutAction()
    }

    Function("clearPendingShortcutAction") { (requestId: String) in
      let defaults = UserDefaults.standard
      guard defaults.string(forKey: Self.requestIdKey) == requestId else { return }
      defaults.removeObject(forKey: Self.actionKey)
      defaults.removeObject(forKey: Self.requestIdKey)
    }

    OnStartObserving {
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(self.shortcutActionReceived),
        name: Self.notification,
        object: nil
      )
    }

    OnStopObserving {
      NotificationCenter.default.removeObserver(
        self,
        name: Self.notification,
        object: nil
      )
    }
  }

  @objc private func shortcutActionReceived(_ notification: Notification) {
    guard
      let action = notification.userInfo?["action"] as? String,
      let requestId = notification.userInfo?["requestId"] as? String
    else { return }
    sendEvent("onShortcutAction", ["action": action, "requestId": requestId])
  }

  private func pendingShortcutAction() -> [String: String]? {
    let defaults = UserDefaults.standard
    guard
      let action = defaults.string(forKey: Self.actionKey),
      let requestId = defaults.string(forKey: Self.requestIdKey)
    else { return nil }
    return ["action": action, "requestId": requestId]
  }
}
