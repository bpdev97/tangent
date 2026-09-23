import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  PERSONAL_PUSH_RELAY_PASSWORD_REDACTED,
  type PersonalPushRelaySettings,
  type PersonalPushRelayTestResult,
} from "@t3tools/contracts/personalPush";
import { useCallback, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings } from "./useScopedSettings";

// Tangent(FORK-PUSH-001): relay URL and password for the self-hosted push
// relay. The password is write-only: the server keeps it in its secret store
// and only reports whether one is saved.

const MIN_PASSWORD_LENGTH = 32;

function describeTestFailure(result: PersonalPushRelayTestResult): string {
  switch (result.failure) {
    case "not_configured":
      return "Save both the relay URL and password first.";
    case "unauthorized":
      return "The relay rejected the saved password.";
    case "unreachable":
      return "The relay could not be reached from this server.";
    default:
      return `The relay returned an unexpected response${result.status ? ` (${result.status})` : ""}.`;
  }
}

export function PersonalPushRelaySettingsSection() {
  const { scope, environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const saved = useScopedSettings((settings) => settings.personalPushRelay);
  if (scope.environmentIds.length !== 1 || environmentId === null) return null;
  // Keyed so the draft resets when the environment or the saved URL changes.
  return (
    <PersonalPushRelayForm
      key={`${environmentId}:${saved.url}`}
      environmentId={environmentId}
      saved={saved}
    />
  );
}

function PersonalPushRelayForm({
  environmentId,
  saved,
}: {
  readonly environmentId: EnvironmentId;
  readonly saved: PersonalPushRelaySettings;
}) {
  const persistServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const testRelay = useAtomCommand(serverEnvironment.testPersonalPushRelay, {
    reportFailure: false,
  });
  const [url, setUrl] = useState(saved.url);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"saving" | "testing" | null>(null);

  const passwordSaved = saved.password === PERSONAL_PUSH_RELAY_PASSWORD_REDACTED;
  const trimmedPassword = password.trim();
  const dirty = url.trim() !== saved.url || trimmedPassword.length > 0;
  const draftValid =
    url.trim().length > 0 && (trimmedPassword.length >= MIN_PASSWORD_LENGTH || passwordSaved);

  const save = useCallback(async () => {
    if (!draftValid || busy) return;
    setBusy("saving");
    const result = await persistServerSettings({
      environmentId,
      input: {
        patch: {
          personalPushRelay: {
            url: url.trim(),
            ...(trimmedPassword.length > 0 ? { password: trimmedPassword } : {}),
          },
        },
      },
    });
    setBusy(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: "Could not save push relay",
          description: "The relay settings were not changed.",
        });
      }
      return;
    }
    setPassword("");
    toastManager.add({
      type: "success",
      title: "Push relay saved",
      description: "The relay password is stored in this server's protected secret store.",
    });
  }, [busy, draftValid, environmentId, persistServerSettings, trimmedPassword, url]);

  const clear = useCallback(async () => {
    if (busy) return;
    setBusy("saving");
    const result = await persistServerSettings({
      environmentId,
      input: { patch: { personalPushRelay: { url: "", password: "" } } },
    });
    setBusy(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not remove push relay",
        description: "The relay settings were not changed.",
      });
    }
  }, [busy, environmentId, persistServerSettings]);

  const test = useCallback(async () => {
    if (dirty || busy) return;
    setBusy("testing");
    const result = await testRelay({ environmentId, input: {} });
    setBusy(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: "Could not test push relay",
          description: "The server could not complete the connection test.",
        });
      }
      return;
    }
    if (result.value.ok) {
      toastManager.add({
        type: "success",
        title: "Push relay connected",
        description: `Authenticated with ${result.value.relayUrl}.`,
      });
      return;
    }
    toastManager.add({
      type: "error",
      title: "Push relay test failed",
      description: describeTestFailure(result.value),
    });
  }, [busy, dirty, environmentId, testRelay]);

  return (
    <SettingsSection title="Notifications">
      <SettingsRow
        {...searchableSetting("personal-push-relay")}
        description={`Route iOS notifications and Live Activity updates through your self-hosted relay. The password must be at least ${MIN_PASSWORD_LENGTH} characters.`}
        control={
          <div className="flex w-full max-w-md flex-col gap-2">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://100.x.y.z:8788"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Personal push relay URL"
            />
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                passwordSaved ? "Password saved. Enter a new one to replace it." : "Relay password"
              }
              autoComplete="new-password"
              spellCheck={false}
              aria-label="Personal push relay password"
            />
            <div className="flex justify-end gap-2">
              {saved.url || passwordSaved ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void clear()}
                >
                  Remove
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="outline"
                disabled={!passwordSaved || dirty || busy !== null}
                onClick={() => void test()}
              >
                {busy === "testing" ? "Testing…" : "Test connection"}
              </Button>
              <Button
                size="xs"
                disabled={!draftValid || !dirty || busy !== null}
                onClick={() => void save()}
              >
                {busy === "saving" ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        }
      />
    </SettingsSection>
  );
}
