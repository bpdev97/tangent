import type { EnvironmentId, SidebarThreadSortOrder } from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import Constants from "expo-constants";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text as RNText, TextInput, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ControlPillMenu } from "../../components/ControlPill";
import { SymbolView } from "../../components/AppSymbol";
import { T3Wordmark } from "../../components/T3Wordmark";
import { HOME_HORIZONTAL_INSET } from "../../lib/layoutMetrics";
import { resolveMobileStageLabel } from "../../lib/mobileBranding";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useThreadListV2Enabled } from "../threads/use-thread-list-v2-enabled";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../layout/native-mail-search-toolbar";
import type { HomeProjectSortOrder } from "./homeThreadList";
import { WorkspaceConnectionTitle } from "./WorkspaceConnectionTitle";
import {
  buildHomeListFilterMenu,
  type HomeListFilterMenuEnvironment,
  type HomeListFilterMenuProject,
} from "./home-list-filter-menu";
import {
  hasCustomHomeListOptions,
  PROJECT_SORT_OPTIONS,
  THREAD_SORT_OPTIONS,
} from "./home-list-options";
import { resolveHomeHeaderPlacement } from "./home-header-placement";

export type HomeHeaderEnvironment = HomeListFilterMenuEnvironment;

export function HomeHeader(props: {
  readonly environments: ReadonlyArray<HomeHeaderEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly searchQuery: string;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly projectSortOrder: HomeProjectSortOrder;
  readonly threadSortOrder: SidebarThreadSortOrder;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly onProjectSortOrderChange: (sortOrder: HomeProjectSortOrder) => void;
  readonly onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
  readonly onOpenEnvironments: () => void;
  readonly onOpenSettings: () => void;
  readonly onStartNewTask: () => void;
  readonly bottomComposerPresent: boolean;
}) {
  if (Platform.OS === "android") {
    return <AndroidHomeHeader {...props} />;
  }

  return <IosHomeHeader {...props} />;
}

type HomeHeaderProps = Parameters<typeof HomeHeader>[0];

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

function AndroidHomeHeader(props: HomeHeaderProps) {
  const insets = useSafeAreaInsets();
  const stageLabel = resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);
  // Thread List v2 lays the list out in fixed creation order, so the
  // sort/group filter controls would be silently ignored — hide them and
  // key the "customized" icon state off the environment filter alone.
  const threadListV2Enabled = useThreadListV2Enabled();
  const hasCustomListOptions = threadListV2Enabled
    ? props.selectedEnvironmentId !== null || props.selectedProjectKey !== null
    : hasCustomHomeListOptions(props);
  const menuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "environment",
        title: "Environment",
        subactions: [
          {
            id: "environment:all",
            title: "All environments",
            state: checkedMenuState(props.selectedEnvironmentId === null),
          },
          ...props.environments.map((environment) => ({
            id: `environment:${environment.environmentId}`,
            title: environment.label,
            state: checkedMenuState(props.selectedEnvironmentId === environment.environmentId),
          })),
        ],
      },
      ...(props.projects.length === 0
        ? []
        : ([
            {
              id: "project",
              title: "Project",
              subactions: [
                {
                  id: "project:all",
                  title: "All projects",
                  state: checkedMenuState(props.selectedProjectKey === null),
                },
                ...props.projects.map((project) => ({
                  id: `project:${project.key}`,
                  title: project.label,
                  state: checkedMenuState(props.selectedProjectKey === project.key),
                })),
              ],
            },
          ] satisfies MenuAction[])),
      ...(threadListV2Enabled
        ? []
        : ([
            {
              id: "project-sort",
              title: "Sort projects",
              subactions: PROJECT_SORT_OPTIONS.map((option) => ({
                id: `project-sort:${option.value}`,
                title: option.label,
                state: checkedMenuState(props.projectSortOrder === option.value),
              })),
            },
            {
              id: "thread-sort",
              title: "Sort threads",
              subactions: THREAD_SORT_OPTIONS.map((option) => ({
                id: `thread-sort:${option.value}`,
                title: option.label,
                state: checkedMenuState(props.threadSortOrder === option.value),
              })),
            },
          ] satisfies MenuAction[])),
    ],
    [
      props.environments,
      props.projectSortOrder,
      props.projects,
      props.selectedEnvironmentId,
      props.selectedProjectKey,
      props.threadSortOrder,
      threadListV2Enabled,
    ],
  );
  const handleMenuAction = useCallback(
    (event: { nativeEvent: { event: string } }) => {
      const id = event.nativeEvent.event;
      if (id === "environment:all") {
        props.onEnvironmentChange(null);
        return;
      }

      if (id.startsWith("environment:")) {
        const environmentId = id.slice("environment:".length);
        const environment = props.environments.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        if (environment) {
          props.onEnvironmentChange(environment.environmentId);
        }
        return;
      }

      if (id === "project:all") {
        props.onProjectChange(null);
        return;
      }

      if (id.startsWith("project:")) {
        const projectKey = id.slice("project:".length);
        if (props.projects.some((project) => project.key === projectKey)) {
          props.onProjectChange(projectKey);
        }
        return;
      }

      const projectSort = PROJECT_SORT_OPTIONS.find(
        (option) => id === `project-sort:${option.value}`,
      );
      if (projectSort) {
        props.onProjectSortOrderChange(projectSort.value);
        return;
      }

      const threadSort = THREAD_SORT_OPTIONS.find((option) => id === `thread-sort:${option.value}`);
      if (threadSort) {
        props.onThreadSortOrderChange(threadSort.value);
        return;
      }
    },
    [props],
  );

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <View
        className="border-b border-header-border bg-header pb-3"
        style={{
          paddingHorizontal: HOME_HORIZONTAL_INSET,
          paddingTop: Math.max(insets.top, 12),
        }}
      >
        <View className="w-full max-w-[720px] self-center gap-3">
          <View className="flex-row items-center gap-2.5">
            {/* Brand slot doubles as the connection status surface: while an
                environment reconnects, the lockup fades to a status label in
                place (no layout shift in the list below). */}
            <WorkspaceConnectionTitle
              grow
              onPress={props.onOpenEnvironments}
              brand={
                <View className="flex-row items-center gap-2">
                  {/* Mirrors the desktop SidebarBrand: T3 mark + muted "Code". */}
                  <T3Wordmark colorClassName="accent-icon" height={15} />
                  <RNText className="-ml-0.5 text-[21px] font-t3-medium tracking-[-0.5px] text-foreground-muted">
                    Code
                  </RNText>
                  <View className="rounded-full bg-subtle px-2 py-0.75">
                    <RNText className="text-[11px] font-t3-bold tracking-[1.1px] text-foreground-muted uppercase">
                      {stageLabel}
                    </RNText>
                  </View>
                </View>
              }
            />

            <ControlPillMenu
              actions={menuActions}
              isAnchoredToRight
              onPressAction={handleMenuAction}
            >
              <Pressable
                accessibilityLabel="Filter and sort threads"
                accessibilityRole="button"
                className="size-11 items-center justify-center rounded-full bg-subtle"
              >
                <SymbolView
                  name={
                    hasCustomListOptions
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease.circle"
                  }
                  size={16}
                  tintColorClassName={"accent-icon"}
                  type="monochrome"
                />
              </Pressable>
            </ControlPillMenu>
            {/* Built identically to the filter button so the two circles
                match exactly (ControlPill sizes via Tailwind classes and
                resolves to a different box). */}
            <Pressable
              accessibilityLabel="Open settings"
              accessibilityRole="button"
              onPress={props.onOpenSettings}
              className="size-11 items-center justify-center rounded-full bg-subtle"
            >
              <SymbolView
                name="gearshape"
                size={18}
                tintColorClassName={"accent-icon"}
                type="monochrome"
              />
            </Pressable>
          </View>

          <View className="min-h-12 flex-row items-center gap-2.5 rounded-2xl border border-input-border bg-input px-3.5">
            <SymbolView
              name="magnifyingglass"
              size={17}
              tintColorClassName={"accent-foreground-muted"}
              type="monochrome"
            />
            <TextInput
              accessibilityLabel="Search threads"
              autoCapitalize="none"
              onChangeText={props.onSearchQueryChange}
              placeholder="Search threads"
              placeholderTextColorClassName="accent-placeholder"
              className="flex-1 py-2.5 text-base font-sans text-foreground"
              value={props.searchQuery}
            />
            {props.searchQuery.length > 0 ? (
              <Pressable
                accessibilityLabel="Clear search"
                hitSlop={10}
                onPress={() => props.onSearchQueryChange("")}
              >
                <SymbolView
                  name="xmark.circle.fill"
                  size={17}
                  tintColorClassName={"accent-foreground-muted"}
                  type="monochrome"
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </>
  );
}

function IosHomeHeader(props: HomeHeaderProps) {
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
  const placement = resolveHomeHeaderPlacement({
    bottomComposerPresent: props.bottomComposerPresent,
    nativeMailSearchToolbarSupported: NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
  });
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
          ].toReversed()
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
              : Platform.OS === "ios"
                ? () => [
                    withNativeGlassHeaderItem({
                      accessibilityLabel: "Open settings",
                      icon: { name: "ellipsis", type: "sfSymbol" } as const,
                      identifier: "home-settings",
                      label: "",
                      onPress: props.onOpenSettings,
                      type: "button",
                    }),
                  ]
                : undefined,
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
