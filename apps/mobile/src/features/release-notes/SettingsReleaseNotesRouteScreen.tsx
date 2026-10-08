/**
 * Tangent(FORK-NOTES-001): Settings → About → Release notes. Lists the notes
 * for this build and the releases before it, read from GitHub when the screen
 * opens. See docs/fork/release-notes.md.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  fetchReleaseNotes,
  hasReleaseNotesFor,
  RELEASE_NOTES_HISTORY_URL,
  selectReleaseNotes,
  type ReleaseNote,
  type ReleaseNoteEntry,
} from "@t3tools/shared/releaseNotes";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Markdown } from "react-native-nitro-markdown";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import {
  hasNativeSelectableMarkdownText,
  SelectableMarkdownText,
} from "../../native/SelectableMarkdownText";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";
import { MOBILE_RELEASE_VERSION, sessionReleaseUpdateAtom, useReleaseUpdate } from "./releaseNotes";

type ReleaseNotesLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "loaded"; readonly releases: ReadonlyArray<ReleaseNote> };

function useReleaseNotes(): ReleaseNotesLoad {
  const [load, setLoad] = useState<ReleaseNotesLoad>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchReleaseNotes()
      .then((releases) => {
        if (!cancelled) setLoad({ status: "loaded", releases });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return load;
}

function ReleaseNoteMarkdown(props: { readonly markdown: string }) {
  const styles = useMarkdownPreviewStyles();
  const onLinkPress = useCallback((href: string) => {
    void tryOpenExternalUrl(href, "markdown-link");
  }, []);

  return hasNativeSelectableMarkdownText() ? (
    <SelectableMarkdownText
      markdown={props.markdown}
      onLinkPress={onLinkPress}
      textStyle={styles.nativeTextStyle}
    />
  ) : (
    <Markdown
      options={{ gfm: true }}
      renderers={styles.renderers}
      styles={styles.styles}
      theme={styles.theme}
    >
      {props.markdown}
    </Markdown>
  );
}

function ReleaseNoteSection(props: {
  readonly release: ReleaseNoteEntry;
  readonly defaultOpen: boolean;
}) {
  const { release } = props;
  const [open, setOpen] = useState(props.defaultOpen);

  return (
    <View className="border-b border-border">
      <Pressable
        accessibilityLabel={`Version ${release.version}${release.isNew ? ", new" : ""}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-3 p-4"
        onPress={() => setOpen((current) => !current)}
      >
        <Text className="text-lg font-t3-medium text-foreground">{release.version}</Text>
        {release.isNew ? (
          <View className="rounded-full bg-card-alt px-2 py-0.5">
            <Text className="text-xs font-t3-medium text-foreground-muted">New</Text>
          </View>
        ) : null}
        <View className="flex-1" />
        <SymbolView
          name={open ? "chevron.down" : "chevron.right"}
          size={16}
          tintColorClassName="accent-chevron"
          type="monochrome"
          weight="semibold"
        />
      </Pressable>
      {open ? (
        <View className="px-4 pb-4">
          <ReleaseNoteMarkdown markdown={release.body} />
        </View>
      ) : null}
    </View>
  );
}

export function SettingsReleaseNotesRouteScreen() {
  const insets = useSafeAreaInsets();
  const { update, acknowledge } = useReleaseUpdate();
  const sessionUpdate = useAtomValue(sessionReleaseUpdateAtom);
  const shownUpdate = sessionUpdate ?? update;
  const load = useReleaseNotes();

  const unpublished =
    load.status === "loaded" && update !== null && !hasReleaseNotesFor(load.releases, update);

  // The update counts as seen once its own notes are on screen, whichever
  // entry point opened them. An update can arrive before its release is
  // published; the row then stays so the notes are offered again.
  useEffect(() => {
    if (load.status === "loaded" && !unpublished) acknowledge();
  }, [acknowledge, load.status, unpublished]);

  const releases =
    load.status === "loaded"
      ? selectReleaseNotes({
          releases: load.releases,
          currentVersion: MOBILE_RELEASE_VERSION,
          sinceVersion: shownUpdate?.from,
        })
      : [];
  const summary = shownUpdate
    ? `Updated from ${shownUpdate.from} to ${shownUpdate.to}`
    : MOBILE_RELEASE_VERSION
      ? `You are on ${MOBILE_RELEASE_VERSION}`
      : null;

  return (
    <SettingsScreen title="Release notes">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {unpublished && update ? (
          <Text className="px-2 text-base text-foreground-muted">
            The notes for {update.to} are not published yet. The update notice stays until they are.
          </Text>
        ) : null}
        {load.status === "loading" ? (
          <View className="items-center py-10">
            <ActivityIndicator colorClassName="accent-icon-muted" />
          </View>
        ) : load.status === "failed" ? (
          <Text className="px-2 text-base text-foreground-muted">
            Could not reach GitHub for the release notes. They are also on the releases page.
          </Text>
        ) : releases.length === 0 ? (
          unpublished ? null : (
            <Text className="px-2 text-base text-foreground-muted">
              No release notes are published for this build yet.
            </Text>
          )
        ) : (
          <SettingsSection {...(summary ? { title: summary } : {})}>
            {releases.map((release, index) => (
              <ReleaseNoteSection
                key={release.version}
                release={release}
                defaultOpen={index === 0}
              />
            ))}
          </SettingsSection>
        )}
        <SettingsSection>
          <SettingsRow
            icon="arrow.up.right"
            label="View on GitHub"
            onPress={() => void tryOpenExternalUrl(RELEASE_NOTES_HISTORY_URL, "markdown-link")}
          />
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
