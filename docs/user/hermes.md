# Hermes

Hermes support is early access and uses Hermes Agent's local TUI gateway. Install and configure
Hermes before adding it to T3 Code.

## Configure a profile

Use Hermes's own CLI for installation, authentication, and model selection:

```bash
hermes --profile default model
```

For another agent configuration, create or configure a named profile:

```bash
hermes --profile research model
```

T3 does not run this interactive setup for you.

## Add it to T3 Code

Open Settings, add a provider instance, and choose Hermes. Set:

```text
Display name: Hermes Research
Binary path: hermes
Hermes profile: research
```

Create a separate provider instance for every profile you want to use. Profiles are not discovered
automatically.

You can choose a Hermes instance and model for an individual chat or set it as a project's default
model selection. Existing threads remain bound to the instance and Hermes session that created
them. Threads created by the older ACP integration start a fresh Hermes session after migration.

## Manage automations

Open Automations in the desktop sidebar, or Settings → Automations on mobile, to manage scheduled
jobs for enabled Hermes profiles across all connected environments. You can create and edit jobs,
pause or resume them, trigger an immediate run, and delete them. T3 uses the binary, profile, and
server-side environment from each Hermes provider instance, so jobs remain isolated to that profile.

Hermes's messaging gateway must be running for scheduled jobs to fire automatically. This is
separate from the isolated chat backend T3 starts:

```bash
hermes --profile <profile> cron status
hermes --profile <profile> gateway install
```

The Automations page manages Hermes jobs; scheduled output is still delivered through the target
configured on each job. It does not currently create or continue T3 chat threads.

## Runtime modes

- Approval required asks before protected operations.
- Auto-accept edits currently retains the same protected-operation prompts as Approval required;
  gateway contract 2 has no safe session-local accept-edits mode.
- Full access automatically answers gateway approval prompts once without creating permanent rules.

Hermes does not currently expose a T3 plan/implementation toggle.

## Troubleshooting

If T3 reports that the binary is missing, set Binary path to the executable returned by:

```bash
command -v hermes
```

If the profile is not ready, configure it and refresh provider status:

```bash
hermes --profile <profile> model
```

If a restored thread fails, verify the same profile still owns the session. Changing a provider
instance's profile intentionally points it at a different Hermes state database.

Automation callbacks into T3 chats are not part of this integration. Scheduled runs do not create
or continue a T3 thread.
