import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";

import { SymbolView } from "../../components/AppSymbol";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useThreadListV2Enabled } from "../threads/use-thread-list-v2-enabled";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../layout/native-mail-search-toolbar";
import { buildHomeListFilterMenu } from "./home-list-filter-menu";
import {
  hasCustomHomeListOptions,
  PROJECT_SORT_OPTIONS,
  THREAD_SORT_OPTIONS,
} from "./home-list-options";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";
import type { HomeHeaderProps } from "./HomeHeader.types";

export function HomeHeader(props: HomeHeaderProps) {
  const searchBarRef = useRef<SearchBarCommands>(null);
  const searchInputRef = useRef<TextInput>(null);
  const [searchActive, setSearchActive] = useState(props.searchQuery.length > 0);
  const headerHeight = useHeaderHeight();
  const theme = useUniwindTheme();
  const iconColor = theme["--color-icon"];
  const mutedColor = theme["--color-foreground-muted"];
  // Thread List v2 lays the list out in fixed creation order, so the
  // sort/group filter controls would be silently ignored — hide them and
  // key the "customized" icon state off the environment filter alone.
  const threadListV2Enabled = useThreadListV2Enabled();
  const hasCustomListOptions = threadListV2Enabled
    ? props.selectedEnvironmentId !== null || props.selectedProjectKey !== null
    : hasCustomHomeListOptions(props);
  const placement = props.bottomComposerPresent
    ? "top"
    : NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
      ? "native-mail-bottom"
      : "legacy-bottom";
  const focusSearch = useCallback(() => {
    if (placement === "top") {
      setSearchActive(true);
      return true;
    }
    searchBarRef.current?.focus();
    return searchBarRef.current !== null;
  }, [placement]);
  useEffect(() => {
    if (!searchActive || placement !== "top") return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [placement, searchActive]);
  useHardwareKeyboardCommand("focusSearch", focusSearch);
  const filterMenu = buildHomeListFilterMenu({
    ...props,
    listOrganization: !threadListV2Enabled,
  });
  const overflowIconName: "line.3.horizontal.decrease.circle.fill" | "ellipsis.circle" =
    hasCustomListOptions ? "line.3.horizontal.decrease.circle.fill" : "ellipsis.circle";
  // The fork's persistent chat composer owns the bottom edge. Keep the
  // upstream toolbar presentation for clients without it, and restore the
  // established top actions when both surfaces would otherwise overlap.
  const topHeaderItems = useMemo<NativeStackHeaderItem[]>(
    () =>
      placement === "top"
        ? [
            withNativeGlassHeaderItem({
              accessibilityLabel: "Search chats and threads",
              icon: { name: "magnifyingglass" as const, type: "sfSymbol" as const },
              identifier: "home-search",
              label: "Search",
              onPress: focusSearch,
              type: "button" as const,
            }),
            withNativeGlassHeaderItem({
              accessibilityLabel: "New thread",
              icon: { name: "square.and.pencil" as const, type: "sfSymbol" as const },
              identifier: "home-new-thread",
              label: "New Thread",
              onPress: props.onStartNewTask,
              type: "button" as const,
            }),
            withNativeGlassHeaderItem({
              accessibilityLabel: "More",
              icon: { name: overflowIconName, type: "sfSymbol" as const },
              identifier: "home-more",
              label: "More",
              menu: {
                title: "Chats and threads",
                items: [
                  ...filterMenu.items.map((item) =>
                    item.type === "action"
                      ? {
                          description: item.subtitle,
                          label: item.title,
                          onPress: item.onPress,
                          state: item.state,
                          type: "action" as const,
                        }
                      : {
                          label: item.title,
                          items: item.items.map((action) => ({
                            description: action.subtitle,
                            label: action.title,
                            onPress: action.onPress,
                            state: action.state,
                            type: "action" as const,
                          })),
                          type: "submenu" as const,
                        },
                  ),
                  {
                    icon: { name: "gearshape" as const, type: "sfSymbol" as const },
                    label: "Settings",
                    onPress: props.onOpenSettings,
                    type: "action" as const,
                  },
                ],
              },
              type: "menu" as const,
            }),
          ].reverse()
        : [],
    [
      filterMenu.items,
      focusSearch,
      overflowIconName,
      placement,
      props.onOpenSettings,
      props.onStartNewTask,
    ],
  );
  return (
    <>
      <NativeStackScreenOptions
        optionsVersion={placement === "top" ? topHeaderItems : filterMenu.items}
        options={{
          ...(placement === "top" ? { headerTitle: "Chats", title: "Chats" } : {}),
          headerTintColor: iconColor,
          unstable_headerRightItems:
            placement === "top"
              ? () => topHeaderItems
              : () => [
                  withNativeGlassHeaderItem({
                    accessibilityLabel: "Open settings",
                    icon: { name: "ellipsis", type: "sfSymbol" } as const,
                    identifier: "home-settings",
                    label: "",
                    onPress: props.onOpenSettings,
                    type: "button",
                  }),
                ],
          // The keys below are set per-branch (not `undefined`) so a later
          // reapply cannot clobber options owned by NativeHeaderToolbar.
          ...(placement === "native-mail-bottom"
            ? {
                unstable_headerToolbarItems: () => [
                  createNativeMailSearchToolbarItem({
                    composeButtonId: "home-new-task",
                    composeSystemImageName: "square.and.pencil",
                    filterMenu,
                    filterButtonId: "home-filter",
                    filterSystemImageName: hasCustomListOptions
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease",
                    onComposePress: props.onStartNewTask,
                    onSearchTextChange: props.onSearchQueryChange,
                    placeholder: "Search",
                    searchTextChangeId: "home-search-text",
                    showsSearchDismissButton: true,
                  }),
                ],
              }
            : placement === "legacy-bottom"
              ? {
                  headerSearchBarOptions: {
                    ref: searchBarRef,
                    autoCapitalize: "none" as const,
                    hideNavigationBar: false,
                    placeholder: "Search",
                    onCancelButtonPress: () => {
                      props.onSearchQueryChange("");
                    },
                    onChangeText: (event) => {
                      props.onSearchQueryChange(event.nativeEvent.text);
                    },
                  },
                }
              : { unstable_headerToolbarItems: () => [] }),
        }}
      />

      {placement === "top" && searchActive ? (
        <View
          className="mx-3 h-11 flex-row items-center gap-2 rounded-xl bg-sidebar-search px-3"
          style={{ marginTop: NATIVE_LIQUID_GLASS_SUPPORTED ? headerHeight + 8 : 8 }}
        >
          <SymbolView name="magnifyingglass" size={17} tintColor={mutedColor} type="monochrome" />
          <TextInput
            ref={searchInputRef}
            accessibilityLabel="Search chats and threads"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-w-0 flex-1 self-stretch text-base text-foreground"
            onChangeText={props.onSearchQueryChange}
            placeholder="Search chats and threads"
            placeholderTextColor={mutedColor}
            returnKeyType="search"
            style={{ lineHeight: 20, paddingVertical: 0 }}
            value={props.searchQuery}
          />
          <Pressable
            accessibilityLabel="Close search"
            hitSlop={10}
            onPress={() => {
              searchInputRef.current?.blur();
              props.onSearchQueryChange("");
              setSearchActive(false);
            }}
          >
            <SymbolView
              name="xmark.circle.fill"
              size={18}
              tintColor={mutedColor}
              type="monochrome"
            />
          </Pressable>
        </View>
      ) : null}

      {placement === "legacy-bottom" ? (
        <NativeHeaderToolbar placement="bottom">
          <NativeHeaderToolbar.Menu
            accessibilityLabel="Filter and sort threads"
            icon={
              hasCustomListOptions
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle"
            }
            title="Thread list options"
            separateBackground
          >
            <NativeHeaderToolbar.Menu title="Environment">
              <NativeHeaderToolbar.Label>Environment</NativeHeaderToolbar.Label>
              <NativeHeaderToolbar.MenuAction
                isOn={props.selectedEnvironmentId === null}
                onPress={() => props.onEnvironmentChange(null)}
                subtitle="Show threads from every environment"
              >
                <NativeHeaderToolbar.Label>All environments</NativeHeaderToolbar.Label>
              </NativeHeaderToolbar.MenuAction>
              {props.environments.map((environment) => (
                <NativeHeaderToolbar.MenuAction
                  key={environment.environmentId}
                  isOn={props.selectedEnvironmentId === environment.environmentId}
                  onPress={() => props.onEnvironmentChange(environment.environmentId)}
                >
                  <NativeHeaderToolbar.Label>{environment.label}</NativeHeaderToolbar.Label>
                </NativeHeaderToolbar.MenuAction>
              ))}
            </NativeHeaderToolbar.Menu>

            {props.projects.length > 0 ? (
              <NativeHeaderToolbar.Menu title="Project">
                <NativeHeaderToolbar.Label>Project</NativeHeaderToolbar.Label>
                <NativeHeaderToolbar.MenuAction
                  isOn={props.selectedProjectKey === null}
                  onPress={() => props.onProjectChange(null)}
                  subtitle="Show threads from every project"
                >
                  <NativeHeaderToolbar.Label>All projects</NativeHeaderToolbar.Label>
                </NativeHeaderToolbar.MenuAction>
                {props.projects.map((project) => (
                  <NativeHeaderToolbar.MenuAction
                    key={project.key}
                    isOn={props.selectedProjectKey === project.key}
                    onPress={() => props.onProjectChange(project.key)}
                  >
                    <NativeHeaderToolbar.Label>{project.label}</NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            ) : null}

            {threadListV2Enabled ? null : (
              <NativeHeaderToolbar.Menu title="Sort projects">
                <NativeHeaderToolbar.Label>Sort projects</NativeHeaderToolbar.Label>
                {PROJECT_SORT_OPTIONS.map((option) => (
                  <NativeHeaderToolbar.MenuAction
                    key={option.value}
                    isOn={props.projectSortOrder === option.value}
                    onPress={() => props.onProjectSortOrderChange(option.value)}
                  >
                    <NativeHeaderToolbar.Label>{option.label}</NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            )}

            {threadListV2Enabled ? null : (
              <NativeHeaderToolbar.Menu title="Sort threads">
                <NativeHeaderToolbar.Label>Sort threads</NativeHeaderToolbar.Label>
                {THREAD_SORT_OPTIONS.map((option) => (
                  <NativeHeaderToolbar.MenuAction
                    key={option.value}
                    isOn={props.threadSortOrder === option.value}
                    onPress={() => props.onThreadSortOrderChange(option.value)}
                  >
                    <NativeHeaderToolbar.Label>{option.label}</NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            )}
          </NativeHeaderToolbar.Menu>
          <NativeHeaderToolbar.Spacer flexible />
          <NativeHeaderToolbar.Button
            accessibilityLabel="New task"
            icon="square.and.pencil"
            onPress={props.onStartNewTask}
            separateBackground
          />
        </NativeHeaderToolbar>
      ) : null}
    </>
  );
}
