# iOS App Shortcuts fork maintenance record

## Decision

Tangent exposes two fixed App Intents to iOS: **New Chat** opens the managed chat composer, and
**Dictate New Chat** opens the same composer and starts its existing voice-input flow. They are App
Shortcuts, available to Shortcuts, Siri, Spotlight, and compatible system controls; they are not
general-purpose URL or command execution surfaces.

The native intent records a bounded action name and unique request ID in app-local defaults before
bringing the app forward. The mobile root listens for warm invocations and also reads the durable
pending action during cold start and foreground transitions. It clears an action only after the
preferred managed-chat project is available and navigation has been dispatched, so startup
hydration or an initially unconfigured app cannot silently lose the request. A later invocation
replaces an older pending request.

## Client behavior

Both shortcuts resolve the managed chat through the same preferred-host selection used by the iOS
Home composer. The native layer never persists an environment or project ID. An explicitly selected
but unavailable preferred host therefore keeps the shortcut pending instead of silently choosing a
different environment.

New Chat preserves the normal context-first composer presentation with the keyboard closed.
Dictate New Chat carries its request ID into that composer and starts voice input once the requested
generic-chat draft owns a durable draft key. The request ID is consumed once per mounted composer,
so permission prompts, settings round trips, foreground transitions, and ordinary rerenders cannot
restart recording.

Dictate New Chat is registered only on iOS 26 and later because Tangent's local Apple transcription
implementation has that minimum. Recording remains foreground-only and uses the existing microphone
permission, interruption, duration, cancellation, and draft-merge behavior.

## Compatibility invariants

- Keep the native action allowlist fixed to `new-chat` and `dictate-new-chat`; do not accept paths,
  shell commands, provider prompts, or arbitrary navigation payloads.
- Resolve the destination from the client project catalog and preferred-chat environment after
  hydration. Never bake environment-local identifiers into App Intent metadata or native defaults.
- Clear a pending request only after navigation is dispatched, and compare request IDs before
  clearing so an older handler cannot erase a newer invocation.
- Start dictation only after the generic-chat draft is ready, and never auto-submit the resulting
  transcript.
- Keep recording foreground-only and share the existing voice controller. Do not add a second audio
  or transcription lifecycle for shortcuts.
- App Intent changes require a native build and a matching Expo runtime fingerprint; they are not an
  OTA-only feature.

## Revalidation procedure

Run:

```sh
vp test apps/mobile/plugins/withIosAppShortcuts.test.ts \
  apps/mobile/src/features/shortcuts/iosAppShortcuts.test.ts \
  packages/client-runtime/src/voice-input/controller.test.ts
vp check
vp run typecheck
vp run lint:mobile
```

Then generate a clean iOS project and build the development client. Confirm both App Shortcuts are
present on an iOS 26-or-later simulator, exercise New Chat from cold and warm app states, and confirm
Dictate New Chat reaches voice preparation exactly once. Complete the recording/transcription pass
on a supported physical device because Simulator does not provide the on-device transcriber.
