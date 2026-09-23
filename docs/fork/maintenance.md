# FORK-MAINT-001: fork maintenance

## Why

Tangent is maintained mostly by an unattended agent that syncs upstream daily and may publish the
result. That only works if the fork is small, every change has a known owner, and the reasons
behind each feature are written down where the agent will read them. This feature is the tooling
and documentation that make that true, kept as small as possible so the tooling itself does not
become maintenance work.

## Behavior

- `downstream/fork.json` holds only what git cannot tell you:
  - `upstream`: the followed branch, the pull request that will merge it, the branch to follow
    afterwards, and the upstream checks that must pass before Tangent moves onto a commit;
  - `baseline`: the upstream commit the stack sits on;
  - `hermes`: the tested Hermes release and the minimum gateway contract;
  - `features`: each feature ID and its record.
- Ownership comes from the commits. Every commit after `baseline` carries a `Fork-Feature` trailer,
  or is a `fixup!`, `squash!`, or `amend!` commit that belongs to the commit it names. There is no
  hand-kept list of files.
- `node scripts/check-fork.ts` fails when `baseline` is not an ancestor of `HEAD`, when a commit
  belongs to no known feature, or when a record is missing or lacks a required section. On success
  it prints how many upstream files each feature touches and its focused test command. `--json`
  prints the upstream files per feature, so a sync can see whether a feature's footprint grew.
- Each feature record uses these sections, in order: **Why**, **Behavior**, **Upstream hooks**,
  **Resolving conflicts**, **Never**, **Remove when**, **Verify**.
- `AGENTS.md` carries one fork block at the very top. The rest of the file is upstream's text.
- Tangent has no fork database migrations. The live databases already carry upstream's names for
  the migration IDs older Tangent builds once occupied, so no bridge is needed. A leftover
  `tangent_sql_migrations` table from those builds is harmless and ignored.

## Upstream hooks

- `AGENTS.md`: the fork block at the top, before upstream's first line.

## Resolving conflicts

- `AGENTS.md`: take upstream's file and put the fork block back on top unchanged. Upstream's
  guidance below it is never edited. If upstream now says something the fork block contradicts,
  update the fork block's substitution list instead.
- `downstream/fork.json`: keep the fork's content. Only `baseline` changes during a sync.

## Never

- Never put a fork migration in upstream's numbered ledger. Upstream's migrator compares IDs only,
  so a fork migration there permanently hides any future upstream migration with the same ID. If a
  fork feature ever needs a schema change, it gets its own ledger table and a record explaining why.
- Never add a commit without a `Fork-Feature` trailer to make a change "belong to nobody". A change
  without a real owner should be dropped.
- Never commit plans, audits, scratch files, or PR-only screenshots.

## Remove when

This feature exists as long as the fork does.

## Verify

```sh
node scripts/check-fork.ts
vp test run scripts/lib/fork-inventory.test.ts
```
