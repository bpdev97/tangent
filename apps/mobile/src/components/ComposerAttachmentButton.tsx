import type { MenuAction } from "@react-native-menu/menu";
import { Pressable } from "react-native";

import { SymbolView } from "./AppSymbol";
import { ControlPillMenu } from "./ControlPill";

const ATTACHMENT_MENU_ACTIONS: MenuAction[] = [
  { id: "photos", title: "Photo Library", image: "photo" },
  { id: "camera", title: "Camera", image: "camera" },
  { id: "files", title: "Choose Files", image: "folder" },
];

const IMAGE_MENU_ACTIONS = ATTACHMENT_MENU_ACTIONS.filter((action) => action.id !== "files");
export function ComposerAttachmentButton(props: {
  readonly disabled?: boolean;
  readonly supportsFiles: boolean;
  readonly onPickMedia: (source?: "library" | "camera") => Promise<void>;
  readonly onPickFiles?: () => Promise<void>;
}) {
  const button = (
    <Pressable
      accessibilityLabel="Add attachment"
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      className="size-[44px] shrink-0 items-center justify-center rounded-full active:opacity-70 disabled:opacity-50"
      disabled={props.disabled}
    >
      <SymbolView
        name="plus"
        size={20}
        weight="regular"
        tintColorClassName="accent-icon"
        type="monochrome"
      />
    </Pressable>
  );

  if (props.disabled) {
    return button;
  }

  return (
    <ControlPillMenu
      accessible
      accessibilityLabel="Add attachment"
      accessibilityRole="button"
      fixedOrder
      actions={props.supportsFiles ? ATTACHMENT_MENU_ACTIONS : IMAGE_MENU_ACTIONS}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "photos") {
          void props.onPickMedia();
        } else if (nativeEvent.event === "camera") {
          void props.onPickMedia("camera");
        } else if (nativeEvent.event === "files") {
          void props.onPickFiles?.();
        }
      }}
    >
      {button}
    </ControlPillMenu>
  );
}
