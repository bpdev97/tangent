---
name: tangent-sync
description: Rebase Tangent onto the latest upstream, keep Hermes support current, and publish a personal release when it is safe. Use for the scheduled Tangent update run or any manual upstream sync of the Tangent fork.
---

# Sync Tangent

Move Tangent onto a newer upstream and decide whether to publish the result. This runs unattended
as a scheduled task inside Tangent itself; a person following it should reach the same decisions.

The guiding rule: **when a feature record does not settle a question, keep upstream's behavior and
do not publish.** A skipped day costs nothing. A wrong guess ships to every device.

`scripts/tangent-sync.ts` does the mechanical work. Your job is the judgment calls: resolving
conflicts from the feature records, fixing failed gates inside the owning feature, and following
Hermes releases. Every subcommand is safe to repeat, so an interrupted run can simply be run again.

The run only publishes. It never installs a release, restarts a server, or updates Hermes.

## Running inside Tangent

The run shares a machine, and possibly a server, with the maintainer's work. So:

- Work in a dedicated clone or worktree of `bpdev97/tangent` with the stack branch (`main`)
  checked out, never a checkout someone is developing in.
- Never touch `~/.bpdev-code/userdata`. Nothing in the sync reads or copies it.
- Never kill a process you did not start and record yourself.
- Never print tokens or credentials; the thread transcript keeps command output.

## 1. Anything to do?

```sh
node scripts/tangent-sync.ts status
```

Tangent only moves to upstream commits whose required checks passed (`upstream.requiredChecks` in
`downstream/fork.json`). `upstreamGreen` is the newest such commit; other checks, such as upstream's
lint ratchets, are advisory because Tangent CI runs its own checks. If `upstreamGreen` is null,
upstream has no green commit recently: report that and stop. If a required check was renamed
upstream, no commit will look green; update the list from `gh pr checks <pr> --required`.

Stop and report "nothing to do" when `action` is `nothing-to-do`. Otherwise note:

- `lastRelease`: if the previous release run failed, say so in your summary.
- `hermesMoved`: a newer Hermes release exists (step 4).
- `upstreamBranchChanged`: upstream's integration branch has merged into `main`, and this sync
  switches to it.

## 2. Rebase

```sh
node scripts/tangent-sync.ts rebase
```

Exit code 2 means a conflict. The script prints the path of a report naming the commit being
replayed, its `Fork-Feature` owner and record, the conflicted files, and the upstream commits that
touched them. For each conflict:

1. Read the owning record's **Resolving conflicts**, **Never**, and **Upstream hooks** sections.
2. Take upstream's version of the file first, then re-apply the fork hook as the record describes.
   Do not keep the fork's old version of upstream code.
3. If upstream now provides the feature, check the record's **Remove when** criteria. When they are
   met, drop the feature's code and hooks instead, add it to `FORK.md`'s removed table, and expect
   the release to be held for review.
4. Needing to change a file the record doesn't mention means the record is incomplete. Stop and
   report instead of guessing.
5. `git add` the resolution, then `node scripts/tangent-sync.ts continue`. Repeat until it
   finishes. Resolutions are recorded (rerere) and reused on later runs.

Give up after two full attempts at the same conflict. `git rebase --abort` returns the branch to
its previous state.

When the rebase completes, the script records the new baseline in `downstream/fork.json` and folds
it into the maintenance commit.

## 3. Gates

```sh
node scripts/tangent-sync.ts gates
```

Locally it installs dependencies and runs `check-fork` and the startup check. The startup check
downloads the latest release's server (verified against `SHA256SUMS`, cached per version), lets it
create a database in an empty temp home, then starts the new build against that database, so
migrations and imports run exactly as they will on an upgraded host.

Then it pushes the rebased commit to the `tangent-sync/candidate` branch and waits for Tangent CI
(`personal-ci.yml`) on GitHub: `vp check`, knip, typecheck, release smoke, the full test suite on
Linux, and mobile lint on macOS. The expensive checks never run on this machine. A run that already
passed for the same commit is reused.

When installing refreshes `pnpm-lock.yaml`, a fork package usually picked up an upstream version
bump; the message says so. Commit the lockfile as a fixup of the feature that owns the changed
importer (for example `apps/push-relay` belongs to FORK-PUSH-001).

A failing gate may be fixed like a conflict, inside the owning feature's files, in at most two
attempts: commit the fix as `fixup! <feature commit subject>`, fold it in with
`GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <baseline>`, and run `gates` again. The CI link
in the failure message shows what broke.

## 4. Hermes releases

When `status` reports a Hermes release newer than `hermes.tag`:

1. Compare the gateway protocol sources listed in the
   [Hermes record](../../../docs/fork/hermes.md) between the two tags, including
   `DESKTOP_BACKEND_CONTRACT`.
2. Update the adapter and its fixtures only for protocol changes that affect a mapping.
3. Update `hermes.version` and `hermes.tag` in `downstream/fork.json` as a `fixup!` of the Hermes
   commit, and run `gates` again. Raising `hermes.minimumContract` holds the release.

## 5. Publish or hold

```sh
node scripts/tangent-sync.ts decide
```

Exit code 3 means hold, with the reasons listed. It holds when:

- a feature touches more upstream files than before the sync;
- `ORCHESTRATION_PROTOCOL_VERSION` changed (clients and servers must update together);
- the Hermes minimum contract changed;
- a feature was removed.

Also hold for anything the records did not settle. When holding, open or update a GitHub issue in
`bpdev97/tangent` with what happened and why; the previous release stays in place.

Only a person clears a hold. After they review it and approve, `node scripts/tangent-sync.ts
accept` records the current stack as the new comparison point, and `decide` passes unless something
changes again. Never run `accept` on your own judgment.

## 6. Release notes

```sh
node scripts/tangent-sync.ts notes
```

It drafts notes from upstream's user-facing commits since the last release, dropping ones that
were already released and only reappeared because upstream force-pushed. Edit the draft file in
place into short, plain-language notes:

- **Upstream:** keep the changes a user would notice and merge related entries; drop internal
  refactors and test-only changes.
- **Tangent:** replace the TODO with what changed in fork features, each conflict you resolved and
  which record settled it, and any Hermes baseline change. Write "No Tangent changes" when true.

`publish` refuses notes that still contain `TODO:` or exceed 30,000 characters.

## 7. Publish

```sh
node scripts/tangent-sync.ts publish
```

It re-checks the decision, then:

- pushes `main` with `--force-with-lease`;
- starts `personal-macos-release.yml` with the next patch version (or the version passed as
  `publish <version>`, which only a person chooses) and the release notes as the
  release body, unless a release for this commit already exists or is running. The workflow creates
  the `personal-v*` tag itself;
- starts `personal-ios-release.yml` in `auto` mode, which ships an OTA update when an iOS build
  with this native fingerprint exists and queues a TestFlight build otherwise;
- disables any upstream workflow a sync brought in, since GitHub enables new workflow files by
  default.

Do not wait for the workflows; the next run's `status` reports how the release went.

Finish with a short summary of the run, anything held and why, and what was published, then end
with the release notes exactly as published. When holding, end with the draft notes instead, marked
as unreleased. A skipped gate is not a pass.
