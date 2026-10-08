import { openReleaseNotes } from "../../lib/releaseNotes";
import { Button } from "../ui/button";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * Tangent(FORK-NOTES-001): Settings → About → Release notes, the way back to
 * the notes once the sidebar notice is gone. See docs/fork/release-notes.md.
 */
export function ReleaseNotesSettingsRow() {
  return (
    <SettingsRow
      {...searchableSetting("release-notes")}
      description="What changed in this version and the ones before it."
      control={
        <Button size="sm" variant="outline" onClick={openReleaseNotes}>
          View notes
        </Button>
      }
    />
  );
}
