# Mobile thread performance

Tangent mobile shortens the lifetime of inactive thread state from upstream's five minutes to one
second and removes avoidable allocations from the thread-open feed path. The shared client-runtime
factories accept an optional retention window, while web and desktop continue to use the upstream
default.

## Why this exists

An Instruments trace from a physical iPhone caught a slow thread switch with the React Native main
thread responsive and the JavaScript thread continuously runnable. Of 1,083 Tangent CPU samples,
1,058 were on the JavaScript thread. Symbolication against the matching Hermes binary placed about
94% of those JavaScript samples in garbage collection, dominated by old-generation allocation
search during young-generation evacuation and weak-root processing.

Thread routes unmount on compact navigation, but upstream retains each stream-backed thread and its
derived detail graph for five minutes after the last subscriber leaves. Large projected threads are
therefore simultaneously reachable while a user browses between them. Tangent's shorter window
preserves transient navigation subscriber gaps but releases inactive graphs before they accumulate
into sustained old-generation pressure.

The same trace pointed at allocation cost during thread opening. Mobile rebuilt the work feed with
`Date` objects created inside a sort comparator, sorted lifecycle rows that the feed subsequently
discarded, and sorted the complete activity history again to find a few pending request events.
These operations are now allocation-light and remain stateless.

## Scope and behavior

- `createEnvironmentThreadStateAtoms` and `createEnvironmentThreadDetailAtoms` accept an optional
  `idleTtlMs`; omitting it preserves the upstream five-minute behavior.
- Tangent mobile supplies the one-second value from `downstream/mobile-runtime-config.ts` to both
  factories. Effect's timeout bucket may retain an inactive graph for up to roughly one additional
  second.
- Active threads are unaffected. Once an inactive graph expires, reopening that thread follows the
  existing local-snapshot hydration and live-resume path.
- Work-feed visibility is unchanged. The existing hidden-row predicates run before sorting, and
  epoch timestamps replace temporary `Date` instances in the final feed sort.
- Pending approvals and user-input prompts still use the existing lifecycle ordering, but only the
  six request-related event kinds enter that sort.
- Pagination, persisted snapshots, websocket traffic, and web/desktop behavior are unchanged.

## Evidence and tradeoffs

A Release-mode iOS Simulator stress fixture mounted and unmounted 48 synthetic threads with 2,200
activities each. The upstream window retained all 144 state/detail/activity atom nodes; Tangent's
window retained none after 1.5 seconds. Under a subsequent 528,000-row projection allocation stress,
the bounded case completed in 5.20 seconds versus 5.44 seconds for upstream retention. The fresh
simulator improvement is modest; the physical trace demonstrates why the benefit grows when a
long-lived heap has already entered pathological collection.

The largest 12 threads in a read-only snapshot of the developer's live database contained 1,855 to
3,217 activities each; 63% to 68% were lifecycle rows mobile does not render. A Release-mode Hermes
benchmark modeled a 3,200-activity recent turn and used three launches per A/B case:

- sorting request state fell from 9.83 ms to 0.18 ms after filtering to request lifecycle events;
- replacing comparator `Date` allocations averaged 50.06 ms before and 46.98 ms after, a 6.2%
  feed-build reduction on an all-visible workload;
- filtering the real-world proportion of hidden lifecycle rows before sorting averaged 21.56 ms
  before and 15.25 ms after, a 29% feed-build reduction.

These are isolated synthetic timings, not a claim that every thread switch becomes 29% faster.
Their value is that each change directly reduces the allocation pattern observed on the phone.

This deliberately trades a near-immediate cached reopen of an inactive thread for bounded mobile
heap reachability. A reopen after expiry can briefly rehydrate from the existing on-device snapshot.

## Removal

Remove the pieces independently as upstream absorbs them:

1. For memory-safe inactive retention, remove `downstream/mobile-runtime-config.ts`, the mobile
   factory options, and their focused tests.
2. When upstream filters hidden feed rows before sorting, uses an allocation-light timestamp
   comparator, or owns an equivalent feed pipeline, remove the matching changes and tests from
   `threadActivity.ts`.
3. When upstream bounds pending-request work to relevant events, restore its request hook.
4. Remove `FORK-PERF-001` and this record only after all three deltas are gone. Re-profile repeated
   large-thread switching on a physical iPhone first.

## Verification

```bash
vp test packages/client-runtime/src/state/threads-atoms.test.ts packages/client-runtime/src/state/entities.test.ts apps/mobile/src/lib/threadActivity.test.ts
vp run lint:mobile
vp run typecheck
vp check
```
