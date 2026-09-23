import * as Notifications from "expo-notifications";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Alert, AppState, Linking, Platform } from "react-native";

import {
  isAtomCommandInterrupted,
  reportAtomCommandResult,
  settleAsyncResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { runtime } from "../../lib/runtime";
import { supportsAgentAwarenessPush } from "../agent-awareness/capabilities";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import {
  getAgentAwarenessRegistrationStatus,
  refreshAgentAwarenessRegistration,
  subscribeAgentAwarenessRegistrationStatus,
} from "../agent-awareness/remoteRegistration";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { resolveAgentAwarenessPlatformPresentation } from "./SettingsRouteScreen.logic";

// Tangent(FORK-PUSH-001): the personal build has no T3 Connect account, so
// notifications are enabled per device and delivered through the personal
// push relay configured on each paired server.

type NotificationStatus = "checking" | "enabled" | "disabled" | "unsupported";

function useDeviceRegistered(): boolean {
  const status = useSyncExternalStore(
    subscribeAgentAwarenessRegistrationStatus,
    getAgentAwarenessRegistrationStatus,
    () => "unknown" as const,
  );
  return status === "registered";
}

export function PersonalNotificationsSettingsScreen() {
  return (
    <SettingsScreen title="Notifications">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="px-5 pt-4">
        <SettingsSection title="Device notifications">
          <DeviceNotificationsRow />
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}

function DeviceNotificationsRow() {
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus>("checking");
  const [requesting, setRequesting] = useState(false);
  const deviceRegistered = useDeviceRegistered();
  const pushAvailable = supportsAgentAwarenessPush();
  const platform = resolveAgentAwarenessPlatformPresentation(Platform.OS);

  const refreshNotifications = useCallback(async () => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      setNotificationStatus("unsupported");
      return;
    }
    const result = await settlePromise(() => Notifications.getPermissionsAsync());
    if (result._tag === "Failure") {
      reportAtomCommandResult(result, { label: "notification permission refresh" });
      setNotificationStatus("disabled");
      return;
    }
    setNotificationStatus(result.value.granted ? "enabled" : "disabled");
  }, []);

  useEffect(() => {
    void refreshNotifications();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshNotifications();
    });
    return () => subscription.remove();
  }, [refreshNotifications]);

  const requestNotifications = useCallback(async () => {
    const result = await settleAsyncResult(() =>
      runtime.runPromiseExit(
        requestAgentNotificationPermission.pipe(
          Effect.tap((permission) =>
            permission.type === "granted" ? refreshAgentAwarenessRegistration() : Effect.void,
          ),
        ),
      ),
    );
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        Alert.alert(
          "Notifications unavailable",
          error instanceof Error ? error.message : "Could not request notification permission.",
        );
      }
      return;
    }
    if (result.value.type === "granted") {
      setNotificationStatus("enabled");
      // Permission alone is not enough: the switch stays off until a server
      // accepted the registration, so say which of the two happened.
      if (getAgentAwarenessRegistrationStatus() === "registered") {
        Alert.alert("Notifications enabled", "Notifications are enabled for this device.");
      } else {
        Alert.alert(
          "Couldn't finish enabling notifications",
          "Notification access was granted, but no paired server could register this device with its push relay. Notifications will start once registration succeeds.",
        );
      }
      return;
    }
    if (result.value.type === "unsupported") {
      setNotificationStatus("unsupported");
      Alert.alert("Notifications unavailable", "Device notifications are only available on iOS.");
      return;
    }
    setNotificationStatus("disabled");
    if (result.value.canAskAgain) {
      Alert.alert("Notifications disabled", "Notifications were not enabled.");
      return;
    }
    Alert.alert(
      "Notifications disabled",
      "Notifications were denied for this app. Open Settings to enable them.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ],
    );
  }, []);

  const handleChange = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        setRequesting(true);
        void requestNotifications().finally(() => setRequesting(false));
        return;
      }
      Alert.alert(
        "Disable notifications",
        "Notification permission is controlled by iOS. Open Settings to disable notifications for this app.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ],
      );
    },
    [requestNotifications],
  );

  return (
    <SettingsSwitchRow
      icon="bell.badge"
      label="Device Notifications"
      disabled={
        requesting ||
        !platform.supported ||
        !pushAvailable ||
        notificationStatus === "checking" ||
        notificationStatus === "unsupported"
      }
      subtitle={platform.subtitle}
      value={pushAvailable && notificationStatus === "enabled" && deviceRegistered}
      onValueChange={handleChange}
    />
  );
}
