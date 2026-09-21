# Maintaining Tangent

Read `FORK.md` for intended behavior and each feature's current maintenance record before editing.
`downstream/fork.json` pins the upstream comparison commit and assigns exact changed paths to
feature IDs. Shared registration files can have several owners. This is a review routing map,
not permission to replace a whole shared file with the fork version.

Run `node scripts/check-fork.ts` from the repository root. It checks upstream ancestry, rejects
unregistered tracked and untracked paths, rejects obsolete inventory entries, and prints focused
test commands derived from each feature's test files. Add or remove ownership entries in the same
PR as a path change. When upstream absorbs a feature, remove its implementation, tests that only
cover the removed delta, and inventory entry after checking its documented replacement criteria.

The checker does not prove a feature works. Run the printed tests for affected features, `vp check`,
and `vp run typecheck`. Mobile changes require `vp run lint:mobile` with its analysis tools installed.
A missing tool or skipped check is not a pass. Visible changes receive an integrated client pass
against isolated state; retain useful evidence in the PR. Do not commit dated audits or PR-only
screenshots. Durable constraints belong in feature docs; merged PRs record completed work.

## Upstream synchronization

The scheduled Tangent workflow fetches upstream and attempts a merge on a branch named for its
commit. A conflicting merge produces a GitHub issue and downloadable report containing both SHAs,
conflicting files, feature owners, and reproduction commands. It aborts the temporary merge and
leaves main unchanged. Resolve the issue in an isolated checkout, then close it from the merged PR.

A clean merge advances the manifest baseline, validates the inventory, pushes without force, and
opens a draft PR. The workflow explicitly dispatches Tangent CI on that branch: pushes and PRs
created with `GITHUB_TOKEN` do not automatically start other workflows. Review the dispatched run
on the PR's exact head commit before marking it ready. Merge upstream syncs with a merge commit;
squashing them loses the ancestry that makes future comparisons reliable.

Personal CI installs upstream's native build prerequisites and limits concurrent workspace test
runs for GitHub-hosted runners. Keep those prerequisites aligned with upstream CI when syncing.
Upstream publishing workflows stay disabled; personal release workflows publish Tangent artifacts.
Fork SQL changes belong in the independent ledger described in [fork migrations](fork-migrations.md).

Tangent carries two temporary upstream test-fixture corrections because macOS releases run the
server suite: GitManager's ambiguous fork-PR test uses the existing local remote rewrite helper,
and UsageService canonicalizes its temporary home before comparing paths or observing scan starts.
This avoids real SSH traffic and macOS `/var` symlink mismatches without changing runtime behavior.
Remove these exceptions when upstream includes equivalent fixture isolation.

Review previews preserve the original index timestamp when preparing a temporary Git index, using
the same conservative timestamp rule as upstream checkpoint capture. A fresh copy timestamp can
hide same-size working-tree edits from Git's racy-index detection when untracked files are present.
This correctness fix and its regression tests remain until upstream's review-index preparation
preserves that detection too; the user's real index must remain unchanged.

Mobile verification follows upstream’s Device panel and AgentDevice workflow. The pairing helper
derives Tangent’s iOS bundle ID and URL scheme from the mobile distribution config; copying
upstream’s literal development identity would open the official app instead. Keep the worktree
state boundary and never test against the installed `~/.bpdev-code/userdata` database.
