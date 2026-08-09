import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { LinearDestinationOpenBehavior, LinearPrBadgeBehavior } from "@t3tools/contracts";
import { normalizeLinearReviewRepository } from "@t3tools/shared/linear";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const BEHAVIOR_LABELS: Record<LinearPrBadgeBehavior, string> = {
  github: "GitHub",
  "linear-review": "Linear",
  choose: "Choose each time",
};

const DESTINATION_BEHAVIOR_LABELS: Record<LinearDestinationOpenBehavior, string> = {
  tangent: "Side panel",
  "linear-app": "Linear app",
};

function repositoryDraft(repositories: ReadonlyArray<string>): string {
  return repositories.join("\n");
}

function parseRepositoryDraft(value: string): {
  readonly repositories: ReadonlyArray<string>;
  readonly invalid: ReadonlyArray<string>;
} {
  const repositories = new Set<string>();
  const invalid: string[] = [];
  for (const line of value.split(/\r?\n/g)) {
    const candidate = line.trim();
    if (!candidate) continue;
    const normalized = normalizeLinearReviewRepository(candidate);
    if (normalized === null) invalid.push(candidate);
    else repositories.add(normalized);
  }
  return { repositories: [...repositories], invalid };
}

export function LinearIntegrationSettingsSection() {
  const settings = usePrimarySettings();
  const primaryEnvironment = usePrimaryEnvironment();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const testConnection = useAtomCommand(serverEnvironment.testLinearConnection, {
    reportFailure: false,
  });
  const saved = settings.linearIntegration;
  const apiKeyConfigured = saved.apiKeyRedacted === true;
  const [apiKey, setApiKey] = useState("");
  const [behavior, setBehavior] = useState<LinearPrBadgeBehavior>(saved.prBadgeBehavior);
  const [destinationBehavior, setDestinationBehavior] = useState<LinearDestinationOpenBehavior>(
    saved.ticketOpenBehavior,
  );
  const [repositories, setRepositories] = useState(() => repositoryDraft(saved.reviewRepositories));
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const parsedRepositories = useMemo(() => parseRepositoryDraft(repositories), [repositories]);
  const normalizedRepositoryDraft = repositoryDraft(parsedRepositories.repositories);
  const savedRepositoryDraft = repositoryDraft(saved.reviewRepositories);
  const dirty =
    apiKey.trim().length > 0 ||
    behavior !== saved.prBadgeBehavior ||
    destinationBehavior !== saved.ticketOpenBehavior ||
    normalizedRepositoryDraft !== savedRepositoryDraft;
  const reviewBehaviorNeedsRepository =
    behavior === "linear-review" && parsedRepositories.repositories.length === 0;
  const canSave =
    dirty &&
    (apiKeyConfigured || apiKey.trim().length > 0) &&
    parsedRepositories.invalid.length === 0 &&
    !reviewBehaviorNeedsRepository;

  useEffect(() => {
    setBehavior(saved.prBadgeBehavior);
  }, [saved.prBadgeBehavior]);
  useEffect(() => {
    setDestinationBehavior(saved.ticketOpenBehavior);
  }, [saved.ticketOpenBehavior]);
  useEffect(() => {
    setRepositories(repositoryDraft(saved.reviewRepositories));
  }, [saved.reviewRepositories]);

  const save = useCallback(async () => {
    if (!primaryEnvironment || !canSave || isSaving) return;
    setIsSaving(true);
    const result = await updateSettings({
      environmentId: primaryEnvironment.environmentId,
      input: {
        patch: {
          linearIntegration: {
            apiKey,
            apiKeyRedacted: apiKey.trim().length > 0 ? false : apiKeyConfigured,
            prBadgeBehavior: behavior,
            ticketOpenBehavior: destinationBehavior,
            reviewRepositories: [...parsedRepositories.repositories],
          },
        },
      },
    });
    setIsSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: "Could not save Linear settings",
          description: "The Linear integration was not changed.",
        });
      }
      return;
    }
    setApiKey("");
    toastManager.add({
      type: "success",
      title: "Linear settings saved",
      description: "The API key is stored in this server's protected secret store.",
    });
  }, [
    apiKey,
    apiKeyConfigured,
    behavior,
    canSave,
    isSaving,
    parsedRepositories.repositories,
    primaryEnvironment,
    destinationBehavior,
    updateSettings,
  ]);

  const remove = useCallback(async () => {
    if (!primaryEnvironment || !apiKeyConfigured || isSaving || isTesting) return;
    setIsSaving(true);
    const result = await updateSettings({
      environmentId: primaryEnvironment.environmentId,
      input: {
        patch: {
          linearIntegration: {
            apiKey: "",
            apiKeyRedacted: false,
          },
        },
      },
    });
    setIsSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({ type: "error", title: "Could not remove Linear API key" });
      }
      return;
    }
    setApiKey("");
    toastManager.add({ type: "success", title: "Linear integration removed" });
  }, [apiKeyConfigured, isSaving, isTesting, primaryEnvironment, updateSettings]);

  const test = useCallback(async () => {
    if (!primaryEnvironment || !apiKeyConfigured || dirty || isTesting) return;
    setIsTesting(true);
    const result = await testConnection({
      environmentId: primaryEnvironment.environmentId,
      input: {},
    });
    setIsTesting(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: "Could not test Linear connection",
          description: "The server could not complete the connection test.",
        });
      }
      return;
    }
    if (result.value.ok) {
      toastManager.add({
        type: "success",
        title: "Linear connected",
        description: result.value.workspaceName
          ? `Authenticated with ${result.value.workspaceName}.`
          : "The saved API key is valid.",
      });
      return;
    }
    const description =
      result.value.failure === "not_configured"
        ? "Save a Linear API key first."
        : result.value.failure === "unauthorized"
          ? "Linear rejected the saved API key."
          : result.value.failure === "rate_limited"
            ? "Linear is rate limiting this API key. Try again later."
            : result.value.failure === "unreachable"
              ? "Linear could not be reached from this server."
              : `Linear returned an unexpected response${result.value.status ? ` (${result.value.status})` : ""}.`;
    toastManager.add({ type: "error", title: "Linear connection failed", description });
  }, [apiKeyConfigured, dirty, isTesting, primaryEnvironment, testConnection]);

  const repositoryStatus =
    parsedRepositories.invalid.length > 0
      ? `Invalid repositories: ${parsedRepositories.invalid.join(", ")}`
      : reviewBehaviorNeedsRepository
        ? "Add at least one Review-enabled repository to open badges in Linear Review."
        : "Only listed repositories get a Linear Review destination; ticket lookup still works for other GitHub PRs.";

  return (
    <SettingsSection title="Linear">
      <SettingsRow
        title="Linear API key"
        description="Looks up Linear tickets attached to GitHub pull requests. The key stays on this server and is never sent to clients."
        status={apiKeyConfigured ? "API key configured" : "Not configured"}
        control={
          <div className="flex w-full max-w-md flex-col gap-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                apiKeyConfigured ? "API key saved — enter a new one to replace it" : "lin_api_…"
              }
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Linear API key"
            />
            <div className="flex justify-end gap-2">
              {apiKeyConfigured ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={isSaving || isTesting}
                  onClick={() => void remove()}
                >
                  Remove
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="outline"
                disabled={!apiKeyConfigured || dirty || isSaving || isTesting}
                onClick={() => void test()}
              >
                {isTesting ? "Testing…" : "Test connection"}
              </Button>
            </div>
          </div>
        }
      />
      <SettingsRow
        title="Open PR badges with"
        description="Choose what the PR number in the new sidebar does. Linear opens Review and the primary linked ticket in separate side-panel tabs. It falls back to the destination menu when Review is unavailable."
        control={
          <Select
            value={behavior}
            onValueChange={(value) => setBehavior(value as LinearPrBadgeBehavior)}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Open PR badges with">
              <SelectValue>{BEHAVIOR_LABELS[behavior]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="github">GitHub</SelectItem>
              <SelectItem value="linear-review">Linear</SelectItem>
              <SelectItem value="choose">Choose each time</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Open Linear in"
        description="Choose where Review and ticket destinations open. The side panel uses separate addressless tabs; Linear app uses desktop deep links."
        control={
          <Select
            value={destinationBehavior}
            onValueChange={(value) =>
              setDestinationBehavior(value as LinearDestinationOpenBehavior)
            }
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Open Linear in">
              <SelectValue>{DESTINATION_BEHAVIOR_LABELS[destinationBehavior]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="tangent">Side panel</SelectItem>
              <SelectItem value="linear-app">Linear app</SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        title="Linear Review repositories"
        description="Enter the GitHub owner/repository names where Linear Review is enabled, one per line."
        status={
          <span
            className={
              parsedRepositories.invalid.length > 0 || reviewBehaviorNeedsRepository
                ? "text-destructive"
                : undefined
            }
          >
            {repositoryStatus}
          </span>
        }
        control={
          <Textarea
            value={repositories}
            onChange={(event) => setRepositories(event.target.value)}
            placeholder={"owner/repository\nanother-owner/another-repository"}
            className="min-h-24 w-full font-mono text-xs sm:w-80"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Linear Review repositories"
          />
        }
      />
      <div className="mx-3 flex flex-col gap-2 border-t border-border/70 pt-3 sm:mx-4 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {dirty ? "You have unsaved changes." : "Linear settings are up to date."}
        </p>
        <Button size="sm" disabled={!canSave || isSaving || isTesting} onClick={() => void save()}>
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </SettingsSection>
  );
}
