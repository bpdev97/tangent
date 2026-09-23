# Hermes

Tangent runs [Hermes Agent](https://github.com/NousResearch/hermes-agent) through its local TUI
gateway. Install and configure Hermes on the machine that runs Tangent's server before adding it.
Hermes 0.21.4 or newer is required.

## Configure a profile

Use Hermes's own CLI to sign in and choose a model:

```bash
hermes --profile default model
```

For another agent configuration, configure a named profile:

```bash
hermes --profile research model
```

Tangent never runs this interactive setup for you.

## Add it to Tangent

Open Settings, add a provider instance, and choose Hermes. Set the binary path (usually `hermes`)
and the Hermes profile. Add one instance per profile you want to use; profiles are not discovered
automatically, and each instance keeps its own sessions and models.

Chats keep the Hermes session that created them, so they resume after Tangent restarts. Hermes
keeps the transcript in the profile's own database.

Model IDs look like `anthropic:claude-sonnet-5`, with the Hermes provider before the colon. "Hermes
default" uses the model configured for the profile.

Hermes slash commands work from the composer. `/compact` runs Hermes's `/compress`. Files Hermes
delivers in a reply appear as links you can open from web, desktop, or mobile.

When background work Hermes started finishes, such as a background command or delegated task,
Hermes replies on its own. The reply appears in the chat after a "Hermes background work finished"
notice. A message you send while Hermes is still writing that reply waits until it finishes.

## Tangent's tools

Hermes can use Tangent's built-in agent tools, such as [visual replies](./html-renders.md),
delegating to another provider, and linking pull requests. They are off until you enable Tangent's
plugin for the profile, once:

```bash
hermes --profile default plugins enable t3-code
```

Then refresh the provider in Settings. Until you do, the provider's status shows this command for
its profile. To turn the tools off again, run the same command with `disable` and refresh. A
refresh applies the change once no Hermes turn or subagent is running for that profile.

Hermes lists these tools as `t3code__…` and finds them through its tool search. They only work in
chats Tangent started; Hermes sessions you start elsewhere are told they are unavailable. Browser
tools also need a Tangent desktop app connected to the same environment, as they do for every
provider.

## Usage

The [Usage](./usage.md) page includes Hermes. It reads the usage Hermes records for every profile
on the machine, so Hermes sessions you run outside Tangent count too. Hermes keeps one running
total per conversation and model, so a conversation you return to over several days is counted on
the last day you used it. Calls covered by a subscription are shown at their estimated API price,
as they are for Codex and Claude. Turns Hermes ran through its Codex runtime appear under Codex,
not Hermes. Tangent reads the Codex home each Hermes account runs with for that.

## Runtime modes

- Approval required asks before commands Hermes considers dangerous. "Allow for this session" lasts
  until the session ends; Tangent never grants Hermes's permanent approval.
- Auto-accept edits asks the same way, because Hermes has no separate edit-only mode.
- Full access answers each approval with "once" and creates no permanent rules.

## Update Hermes

When a newer Hermes release is available, the provider's version details show an update action on
any client. Tangent runs the update command Hermes reports for its install method, then checks the
new version. A source install pinned to a release tag moves to the newest release and stays on
releases; one that follows a branch keeps following it. Stop or finish running Hermes turns first;
the update restarts Hermes for every profile, and open chats reconnect on their next message.
Tangent never updates Hermes on its own.

If Hermes is too old for Tangent, the provider shows as incompatible with the same update action.
Installs that Hermes cannot update in place (for example Nix) have no update action; update them
the way you installed them.

## Troubleshooting

If Tangent reports that the binary is missing, set the binary path to the output of:

```bash
command -v hermes
```

If the profile has no model, configure it and refresh the provider status:

```bash
hermes --profile <profile> model
```

Changing an instance's profile points it at a different Hermes database, so existing chats on that
instance can no longer resume their sessions.
