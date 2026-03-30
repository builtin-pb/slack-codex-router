# Slack Codex Router v2 Stronger Tests Design

Date: 2026-03-30

## Overview

The current `v2` suite is now strong enough for day-to-day refactoring, but it still leaves two important gaps:

- several stateful Slack control flows are only proven at the handler-routing or service-unit level, not as integrated runtime behavior
- the highest-risk operational seams still rely on fakes: real `git worktree` execution, real child-process App Server transport, and the real restart loop across router worker generations

The next test push should address both gaps at once.

It should not be “more end-to-end tests only.” It should be a two-track expansion:

- add fast, harness-backed integration tests for user-facing Slack/runtime/control behavior
- add a separate real-integration suite for real git, real child-process transport, and true cross-boot restart behavior

## Goals

- Keep `npm --prefix v2 test` fast enough for normal development.
- Increase confidence in stateful Slack control flows without pushing everything into slow process tests.
- Prove `WorktreeManager` and adjacent git paths against a real temporary repository.
- Prove App Server JSON-line transport behavior through a real child process, not just local doubles.
- Prove restart behavior across persisted intent, exit code `75`, launcher restart, recovery posting, and first post-restart thread rebind.
- Add helpers that make future fast integration tests and real-integration tests cheap to extend.

## Non-Goals

- Do not add live Slack network tests.
- Do not depend on the real Codex App Server binary.
- Do not replace the current fast in-process harness with only child-process tests.
- Do not move the codebase toward browser or container E2E tooling.
- Do not chase coverage percentage for its own sake.

## Current Gap

The suite now proves:

- low-level logic in config, router event mapping, restart helpers, and many service branches
- in-process integration for top-level message flow and a narrow live-control slice
- smoke-level bootstrap and launcher behavior

It still does not prove enough in these areas:

### Stateful Slack/Runtime Gaps

- `tool/requestUserInput` through actual `codex_choice:*` action handling
- stale buttons or stale controls after restart recovery
- top-level control actions when Slack sends `message.ts` without `thread_ts`
- integrated merge preview/confirm action flow against persisted thread state
- stale-session rebound rollback when a recovered thread fails during rebind
- mixed persisted-thread recovery semantics in one place
- restart-intent overwrite semantics across multiple requests

### Real Operational Gaps

- `git worktree add` against a real repository, including negative cases
- real root-dirtiness caused by `.codex-worktrees/`
- real merge semantics from repo root while the source branch is checked out in a linked worktree
- real child-process stdout framing behavior
- real process death during an outstanding request
- the actual launcher-mediated restart loop, not just a harness reboot
- the first post-restart reply that must rebind a stale thread to a fresh App Server thread

## Approach Options

### Option 1: Real-Integration Only

Pros:

- highest realism per test
- directly exercises the most failure-prone seams

Cons:

- misses several important user-facing Slack/control behaviors that are easier and cheaper to prove in the fast suite
- worse failure localization
- slower iteration

### Option 2: Fast-Suite Only

Pros:

- simplest to implement
- very fast feedback loop

Cons:

- still leaves the operational git/process/restart seams under-proven
- does not answer the core “does this really work end to end at the risky boundaries?” question

### Option 3: Two-Track Expansion

Pros:

- keeps the fast suite valuable for frequent development
- closes the highest-risk operational gaps explicitly
- preserves good failure localization
- matches how the system actually fails in practice: some bugs are state-machine bugs, others are process/git boundary bugs

Cons:

- requires two kinds of fixtures
- requires discipline to keep slow tests out of the default suite

## Recommendation

Choose Option 3.

The target shape should be:

- `npm --prefix v2 test`
  fast unit, contract, and harness-backed integration tests
- `npm --prefix v2 run build`
- `npm --prefix v2 run coverage`
- `npm --prefix v2 run test:real-integration`
  real git, real child-process, and restart-loop tests

That split gives the repo stronger operational confidence without degrading the normal edit/test loop.

## Target Test Layers

### Layer 1: Unit Tests

Keep the current narrow logic tests.

### Layer 2: Contract Tests

Keep the current module-boundary tests for App Server client/process, service branches, restart persistence, and git helper parsing.

### Layer 3: Fast In-Process Integration Tests

Use the existing runtime harness pattern to cover real `RouterStore`, real `RouterService`, real runtime startup, real Slack action registration, and fake-but-stateful Slack/App Server edges.

This layer should absorb the missing user-facing stateful flows.

### Layer 4: Dedicated Real-Integration Tests

Add a separate suite that uses:

- a real temporary git repository
- the real `git` binary
- a real child-process App Server stub
- the real `spawnAppServerProcess()`
- the real `AppServerClient`
- the real launcher/router restart loop where practical

This layer should stay intentionally small and high-signal.

## Fast-Suite Scope

The next fast-suite additions should cover:

### Request-User-Input Round Trip

Drive:

- runtime receives `tool/requestUserInput`
- Slack buttons are rendered
- a real registered `codex_choice:*` action is clicked
- store transitions from `awaiting_user_input` to `running`
- a new turn id is persisted

### Stale Controls After Recovery

After recovery marks a thread stale:

- old choice buttons should fail cleanly
- stale idle review attempts should fail cleanly
- persisted state should remain unchanged on those failures

### Top-Level Action Context Fallback

Prove `status` or `restart_router` works when Slack provides:

- `message.ts`
- no `thread_ts`

That is the real top-level control shape for some Slack payloads.

### Integrated Merge Action Flow

Prove:

- `merge_to_main` preview action returns a confirmation payload
- `confirm_merge_to_main` applies against the current persisted branch pair
- persisted thread state moves back to repo root/base branch and becomes stale as intended
- replaying an old confirmation fails cleanly without a second merge

### Stale Rebind Rollback

For a stale recovered thread:

- `threadStart` succeeds
- `turnStart` fails

The original record should be restored, including stale flag and prior App Server thread id.

### Recovery Semantics Matrix

Seed multiple persisted rows and prove recovery semantics in one place:

- `idle` stays `idle`
- `running`, `awaiting_user_input`, and `interrupted` become `interrupted`
- every recovered row clears `activeTurnId`
- recovered rows become stale
- `failed_setup` is excluded from recoverable flow

### Restart Intent Overwrite

Because restart intent is stored as a singleton row, only the latest requesting Slack thread should receive the recovery notice.

That behavior should be pinned explicitly.

## Dedicated Real-Integration Scope

### Real Git Worktree Tests

Add real-repo tests for:

- happy-path worktree creation from the default branch
- happy-path worktree creation from a non-default branch whose tip differs from default
- failure on nonexistent `baseBranch`
- failure on a non-empty preexisting worktree directory
- failure when the old worktree path is gone but the branch still exists

The non-default branch case must assert that the new worktree `HEAD` matches the requested branch tip, not merely that it shares an ancestor.

### Real Root Dirtiness And Merge Semantics

Add real-repo tests for:

- whether `.codex-worktrees/` makes the root repo appear dirty
- a real merge from repo root while the source branch is checked out in a linked worktree
- store safety when merge fails

These tests should distinguish between:

- pure git helper behavior
- router-level persisted thread mutation behavior

### Real Child-Process Transport

Add a child-process App Server stub that:

- reads JSON lines from stdin
- writes JSON lines to stdout
- logs requests for assertion
- can emit notifications itself over stdout
- can intentionally fragment output or coalesce multiple messages in one write
- can exit during an outstanding request

The tests must assert actual request payloads, not only method presence. Important fields include:

- `cwd`
- normalized text input payloads
- propagated `threadId`
- propagated `turnId`

### Real Restart Loop

The restart proof must be a true cross-boot operational path:

1. create a real Slack thread mapping on boot 1
2. request restart through the real control surface
3. observe router worker exit code `75`
4. let launcher or an equivalent real worker-generation loop start boot 2 against the same sqlite store
5. prove recovery posting occurs
6. send the first post-restart reply
7. prove stale-session rebind performs a fresh `thread/start`, clears staleness, and starts a new turn

The manual `rebootRuntime()`-only shape is not enough by itself.

Split that proof deliberately:

- the router/runtime real-integration test proves restart control action, persisted intent, recovery post, and first post-restart stale-session rebound against the same sqlite store
- the launcher smoke proves that a worker exiting with code `75` causes a new worker generation to start

### Real Process Failure Cases

Add at least one high-signal failure case where:

- the child dies after request receipt but before response

Then prove router state rolls back the same way the mocked rejection tests expect.

## Fixture Design

### Temporary Git Repository Helper

Create a helper under `v2/test/helpers/` that:

- initializes a temp repo
- configures local git username/email
- uses a version-tolerant init flow instead of assuming `git init -b main`
- creates initial commits and optional diverged branches
- exposes helper methods for:
  - current branch
  - `rev-parse HEAD`
  - branch tip resolution
  - cleanup

### Real App Server Stub Fixture

Create:

- a stub script under `v2/test/fixtures/`
- a harness helper under `v2/test/helpers/`

The stub should support explicit scenarios, for example:

- `happy-path`
- `fragmented-output`
- `coalesced-output`
- `exit-during-turn-start`
- `idle`

The helper should expose:

- request log inspection
- top-level Slack message dispatch
- action dispatch
- cleanup
- cross-boot reuse of the same sqlite store when needed

## Package Script Design

Add dedicated suite-selection configs and package scripts:

- `vitest.fast.config.ts`
- `vitest.real-integration.config.ts`
- `test:real-integration`

The default `test` and `coverage` commands must actively exclude `v2/test/real_integration/**`, not merely add another script. Otherwise the slow suite will leak back into the default developer loop.

A simple durable shape is:

- `vitest.fast.config.ts`
  includes `test/**/*.test.ts`
  excludes `test/real_integration/**/*.test.ts`
- `vitest.real-integration.config.ts`
  includes `test/real_integration/**/*.test.ts`

Then wire scripts to those configs directly.

## Verification Strategy

The stronger-test project succeeds when:

1. `npm --prefix v2 test` still passes quickly.
2. `npm --prefix v2 run build` still passes.
3. `npm --prefix v2 run coverage` still passes.
4. `npm --prefix v2 run test:real-integration` passes locally.
5. Fast-suite additions prove the missing stateful Slack/control/runtime flows.
6. Real-integration additions prove real git/worktree behavior, real transport framing, and a true cross-boot restart path.
7. The suite remains split cleanly enough that developers will keep using both layers.

## Risks And Mitigations

### Risk: Real Git Tests Become Environment-Sensitive

Mitigation:

- avoid `git init -b` assumptions
- configure repo-local identity
- keep the repo shape simple and local

### Risk: Child-Process Tests Become Flaky

Mitigation:

- use explicit scenario scripts
- assert durable outcomes, not timing-sensitive micro-events
- make the stub emit notifications over stdout itself instead of bypassing the transport

### Risk: The Real-Integration Suite Drifts

Mitigation:

- select by directory or pattern, not a brittle file list
- document the full verification path alongside the fast suite

### Risk: The Restart Test Overclaims Confidence

Mitigation:

- require a true cross-boot flow
- require first post-restart stale-session rebind proof

## Success Criteria

- The repo has a clear fast-suite vs real-integration-suite split.
- The fast suite proves the important Slack/control state-machine behaviors that were previously only partially covered.
- The real-integration suite proves the highest-risk git/process/restart boundaries directly.
- The non-default base-branch, stale-session, and restart claims are backed by strong assertions instead of weak approximations.
- Confidence increases materially without turning the default suite into a slow operational test harness.
