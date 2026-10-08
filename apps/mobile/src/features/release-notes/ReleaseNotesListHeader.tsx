/**
 * Tangent(FORK-NOTES-001): the row above the thread list after an update. It
 * stays until the notes are opened or it is dismissed, and renders nothing
 * otherwise. See docs/fork/release-notes.md.
 */
import { useNavigation } from "@react-navigation/native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { useReleaseUpdate } from "./releaseNotes";

/** Wraps the thread list's own header so the row sits between it and the first thread. */
export function ReleaseNotesListHeader(props: { readonly children?: ReactNode }) {
  const navigation = useNavigation();
  const { update, acknowledge } = useReleaseUpdate();
  if (!update) return props.children ?? null;

  return (
    <>
      {props.children}
      <View className="mx-4 mb-2 flex-row items-center rounded-2xl border-continuous bg-grouped-card">
        <Pressable
          accessibilityHint="Opens the release notes"
          accessibilityLabel={`Updated to ${update.to}. See what's new`}
          accessibilityRole="button"
          className="min-w-0 flex-1 flex-row items-center gap-3 py-3 pl-4"
          onPress={() =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: { screen: "SettingsReleaseNotes" },
            })
          }
        >
          <SymbolView
            name={{ ios: "sparkles", android: "auto_awesome" }}
            size={20}
            tintColorClassName="accent-icon"
            type="monochrome"
            weight="regular"
          />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-t3-medium text-foreground">Updated to {update.to}</Text>
            <Text className="text-sm text-foreground-muted">See what's new</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityLabel="Dismiss update notice"
          accessibilityRole="button"
          className="p-4"
          hitSlop={8}
          onPress={acknowledge}
        >
          <SymbolView
            name="xmark"
            size={14}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
            weight="semibold"
          />
        </Pressable>
      </View>
    </>
  );
}
