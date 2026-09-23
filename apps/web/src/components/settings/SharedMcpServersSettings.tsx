import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import {
  SHARED_MCP_SERVERS_UNSUPPORTED_DRIVERS,
  type SharedMcpServers,
} from "@t3tools/contracts/sharedMcpServers";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { getDriverOption } from "./providerDriverMeta";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import {
  EMPTY_SHARED_MCP_SERVER_DRAFT,
  emptySharedMcpHeader,
  renameSharedMcpHeader,
  type SharedMcpServerDraft,
  sharedMcpServerDraft,
  sharedMcpServerFromDraft,
} from "./sharedMcpServers.logic";

// Tangent(FORK-MCP-001): HTTP MCP servers attached to every provider session
// on this environment. Like provider instances, they belong to the machine the
// page displays, and header values are write-only.

const providerLabel = (provider: ServerProvider) =>
  provider.displayName ?? getDriverOption(provider.driver)?.label ?? provider.driver;

export function SharedMcpServersSettings({
  environmentId,
  servers,
  providers,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly servers: SharedMcpServers;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly readOnly: boolean;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  // `null` edits a new server; a name edits that saved server.
  const [editing, setEditing] = useState<{ readonly name: string | null } | null>(null);
  const editingServer =
    editing?.name == null ? undefined : servers.find((server) => server.name === editing.name);
  const save = (mcpServers: SharedMcpServers) => updateSettings({ mcpServers });

  const describe = (server: SharedMcpServers[number]) => {
    const off = providers
      .filter((provider) => server.disabledProviderInstances.includes(provider.instanceId))
      .map(providerLabel);
    return off.length === 0 ? server.url : `${server.url} · Off for ${off.join(", ")}`;
  };

  return (
    <>
      <SettingsSection
        {...searchableSetting("mcp-servers")}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="outline" onClick={() => setEditing({ name: null })}>
              <PlusIcon className="size-3" aria-hidden />
              Add server
            </Button>
          ) : null
        }
      >
        {servers.length === 0 ? (
          <SettingsRow
            title="No MCP servers configured."
            description="Servers added here are available to every provider on this environment except Hermes and Pi."
          />
        ) : (
          servers.map((server) => (
            <SettingsRow
              key={server.name}
              title={server.name}
              description={<span className="break-all">{describe(server)}</span>}
              control={
                <div className="flex items-center gap-2">
                  {!readOnly ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setEditing({ name: server.name })}
                    >
                      Edit
                    </Button>
                  ) : null}
                  <Switch
                    checked={server.enabled}
                    disabled={readOnly}
                    aria-label={`Enable ${server.name}`}
                    onCheckedChange={(checked) =>
                      save(
                        servers.map((entry) =>
                          entry.name === server.name
                            ? { ...entry, enabled: Boolean(checked) }
                            : entry,
                        ),
                      )
                    }
                  />
                </div>
              }
            />
          ))
        )}
      </SettingsSection>
      {editing && !readOnly && (editing.name === null || editingServer) ? (
        <SharedMcpServerEditor
          key={editing.name ?? ""}
          initial={
            editingServer ? sharedMcpServerDraft(editingServer) : EMPTY_SHARED_MCP_SERVER_DRAFT
          }
          isNew={editing.name === null}
          otherServers={servers.filter((server) => server.name !== editing.name)}
          providers={providers}
          onClose={() => setEditing(null)}
          onSave={(server) => {
            save(
              editing.name === null
                ? [...servers, server]
                : servers.map((entry) => (entry.name === editing.name ? server : entry)),
            );
            setEditing(null);
          }}
          onRemove={() => {
            save(servers.filter((server) => server.name !== editing.name));
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function SharedMcpServerEditor({
  initial,
  isNew,
  otherServers,
  providers,
  onClose,
  onSave,
  onRemove,
}: {
  readonly initial: SharedMcpServerDraft;
  readonly isNew: boolean;
  readonly otherServers: SharedMcpServers;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly onClose: () => void;
  readonly onSave: (server: SharedMcpServers[number]) => void;
  readonly onRemove: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const result = sharedMcpServerFromDraft(draft, otherServers);
  const setHeader = (header: SharedMcpServerDraft["headers"][number]) =>
    setDraft({
      ...draft,
      headers: draft.headers.map((entry) => (entry.id === header.id ? header : entry)),
    });
  const setProviderEnabled = (instanceId: ProviderInstanceId, enabled: boolean) =>
    setDraft({
      ...draft,
      disabledProviderInstances: enabled
        ? draft.disabledProviderInstances.filter((id) => id !== instanceId)
        : [...draft.disabledProviderInstances, instanceId],
    });

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup
        render={
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setAttempted(true);
              if ("server" in result) onSave(result.server);
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>{isNew ? "Add MCP server" : `Edit ${initial.name}`}</DialogTitle>
          <DialogDescription>
            Streamable HTTP servers only. The URL is resolved on this environment's machine, and
            changes apply to sessions that start afterwards.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {isNew ? (
            <label className="block space-y-1.5 text-sm">
              <span>Name</span>
              <Input
                autoFocus
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="executor"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
          ) : null}
          <label className="block space-y-1.5 text-sm">
            <span>URL</span>
            <Input
              autoFocus={!isNew}
              required
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              placeholder="http://127.0.0.1:4788/mcp"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <fieldset className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <legend>Headers</legend>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() =>
                  setDraft({
                    ...draft,
                    headers: [...draft.headers, emptySharedMcpHeader()],
                  })
                }
              >
                <PlusIcon className="size-3" aria-hidden />
                Add header
              </Button>
            </div>
            {draft.headers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                None. Values are stored in this server's secret store and never shown again.
              </p>
            ) : (
              draft.headers.map((header) => (
                <div key={header.id} className="flex items-center gap-2">
                  <Input
                    value={header.name}
                    onChange={(event) =>
                      setHeader(renameSharedMcpHeader(header, event.target.value))
                    }
                    placeholder="Authorization"
                    aria-label="Header name"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  <Input
                    type="password"
                    value={header.value}
                    onChange={(event) => setHeader({ ...header, value: event.target.value })}
                    placeholder={header.saved ? "Saved" : "Value"}
                    aria-label={`${header.name || "Header"} value`}
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${header.name || "header"}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        headers: draft.headers.filter((entry) => entry.id !== header.id),
                      })
                    }
                  >
                    <XIcon />
                  </Button>
                </div>
              ))
            )}
          </fieldset>
          {providers.length > 0 ? (
            <fieldset className="space-y-2 text-sm">
              <legend>Providers</legend>
              {providers.map((provider) => {
                const unsupported = SHARED_MCP_SERVERS_UNSUPPORTED_DRIVERS.has(provider.driver);
                return (
                  <label key={provider.instanceId} className="flex items-center gap-2">
                    <Checkbox
                      checked={
                        !unsupported &&
                        !draft.disabledProviderInstances.includes(provider.instanceId)
                      }
                      disabled={unsupported}
                      onCheckedChange={(checked) =>
                        setProviderEnabled(provider.instanceId, Boolean(checked))
                      }
                    />
                    <span>{providerLabel(provider)}</span>
                    {unsupported ? (
                      <span className="text-xs text-muted-foreground">Not supported</span>
                    ) : null}
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          {attempted && "error" in result ? (
            <p role="alert" className="text-xs text-destructive">
              {result.error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {!isNew ? (
            <div className="mr-auto">
              <Button type="button" variant="ghost" onClick={onRemove}>
                Remove
              </Button>
            </div>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
