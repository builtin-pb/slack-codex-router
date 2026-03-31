# Slack Codex Router v2 Heavy E2E Test Campaign Design

Date: 2026-03-31

## Overview

The current `v2` test suite is useful for regressions but still too optimistic about whether the system will work under real operating conditions. It proves many seams in isolation, but it does not yet provide credible confidence that the router can handle a realistic multi-round workflow with real persistence, real process boundaries, real git state, and restart recovery in the middle of active work.

This design raises the bar from "stronger tests" to "credible system proof." The emphasis is not line coverage or more seam tests. The emphasis is heavy scenario tests that exercise the real `v2` stack end to end:

- real router and launcher entrypoints
- real SQLite persistence on disk
- real temp git repositories and real `git worktree` operations
- real child-process App Server transport
- real restart cycles across process generations
- deterministic scripted agent behavior that edits files, asks for user input, resumes after restart, and can fail at awkward moments

The primary confidence gate must remain deterministic and repo-contained. A live Codex-backed scenario can be added as an optional local smoke layer, but it should not be the main pass/fail gate because reproducibility matters more than absolute realism for regression protection.

## Goals

- Make `v2` test confidence depend on heavy, realistic scenarios instead of mostly seam-level proofs.
- Prove that a real multi-round interaction can build a toy app in a temp project through the router.
- Prove that the same workflow survives interrupted child processes, router restarts, stale controls, and rebinds.
- Prove that real git worktree and merge behavior matches the router's persisted state transitions.
- Force production bugs to surface under scenario pressure, then fix those bugs in the same implementation pass.
- Document the new test architecture clearly enough that future contributors can extend it without rebuilding the approach from scratch.

## Non-Goals

- Do not add live Slack network tests.
- Do not depend on a production Codex service or live model output for the main passing test path.
- Do not replace every fast integration test with a process test when a fast in-process proof is enough.
- Do not chase 100% statement coverage as a substitute for operational confidence.
- Do not modify `legacy/v1`; all work targets `v2/`.

## Problems With The Current Shape

The repo already contains a meaningful amount of test code, including prior "stronger tests" passes. That is not enough for the requested confidence level because the heaviest risk areas are still under-proven:

- multi-round user interaction is not exercised deeply enough as a single scenario
- restart and recovery are tested, but not with a long-lived workflow that keeps building after interruption
- real child-process App Server behavior is not stressed hard enough for framing, death, restart, and outstanding-request failure modes
- real git tests exist, but they do not yet anchor a full workflow from Slack request to final repo mutation
- duplicate delivery, replay, stale controls, and corner-case recovery semantics are not tested as a coordinated system

The result is a suite that can still pass while the integrated experience is broken in ways a real user would hit.

## Decision

Adopt a three-layer confidence model with the majority of new confidence coming from heavy real-integration scenarios.

### Layer 1: Fast Runtime Integrations

Keep the fast suite, but narrow its purpose:

- prove state machines that are easier to localize in-process
- cover handler wiring and high-signal control flows
- support bug isolation when a real-integration test fails

This layer is useful, but it is not the primary source of confidence.

### Layer 2: Heavy Real-Integration Tests

Make `test:real-integration` the main confidence suite. This layer must use:

- real entrypoints
- real disk-backed persistence
- real git repositories and worktrees
- real child processes
- real restart behavior
- deterministic scripted agent behavior

This layer is where the system must prove it can survive the kinds of failures users actually care about.

### Layer 3: Optional Live-Codex Smokes

Add a documented, optional test path for running a toy scenario against a live Codex runtime when a machine is configured for it. This is useful as a realism supplement, but it must stay opt-in and clearly separated from the deterministic gate.

This optional layer should support a more realistic "Codex talks to Codex through mocked Slack" scenario:

- one live Codex agent acts as the worker that receives the routed task
- the router still runs for real
- the Slack side remains mocked and controlled by the test harness
- a second live Codex agent can act as a judge

The judge must not be a free-form oracle. It should make its pass/fail decision from captured evidence:

- Slack transcript
- router/store state snapshots
- git diff or final filesystem state
- explicit scenario rubric

That keeps the scenario realistic without making it completely unrepeatable.

## Core Design Principles

### Determinism First

The default confidence suite must be deterministic enough to fail on regressions instead of flaking on nondeterministic model behavior. That means the primary scenario runner should use a scripted child-process App Server or agent stub that behaves like a realistic peer while remaining fully controlled by the test.

### Test Stories, Not Just Seams

The new suite must center on long-form scenarios, not isolated seam assertions. A scenario should cover:

- Slack input
- router persistence
- app-server communication
- user-input suspension and resume
- file edits
- recovery after interruption
- worktree or merge consequences

### Pressure The Failure Paths

Every heavy scenario should include at least one awkward condition: duplicate events, stale actions, fragmented stdout, child exit during a pending request, replayed merge confirm, or restart between turns.

### Fix Bugs In The Same Pass

The job is not done when a heavy test exposes a production bug. The production fix belongs in the same implementation campaign unless it would expand scope beyond the architecture already under test.

## Proposed Scenario Families

### 1. Multi-Round Toy-App Build Scenario

This is the anchor scenario for the campaign.

Flow:

1. Start the real router against a temp project registry and disk-backed store.
2. Send a top-level Slack message requesting a simple toy app change.
3. Route the request through a real child-process scripted agent that:
   - starts a thread
   - creates or updates real files in the temp project
   - emits normal progress notifications
   - asks at least one `requestUserInput` question
   - resumes after the simulated user response
   - completes with verifiable file contents
4. Assert both persisted thread state and real filesystem outcomes.

Required assertions:

- the router persists the thread mapping and active turn information correctly
- user-input suspension changes state to `awaiting_user_input`
- the resume action returns the thread to `running`
- final state is coherent and cleanup paths run
- resulting files on disk match the scenario contract

### 2. Restart-In-The-Middle Build Scenario

Use the same style of scripted agent, but terminate the router worker or app-server process after meaningful progress has already been persisted.

Flow:

1. Begin a multi-round build.
2. Interrupt during either an active turn or a waiting-for-input turn.
3. Restart through the real launcher or real router boot path.
4. Assert recovery notices, stale flags, and persisted state transitions.
5. Continue the build from a fresh Slack reply or allowed resume path.
6. Confirm the toy app still completes successfully.

Required assertions:

- recovered records become stale where intended
- old controls are rejected without corrupting state
- the next real user message rebinds the thread correctly
- the resumed scenario edits the same real project successfully

### 3. Duplicate And Replay Safety Scenario

Prove that duplicate delivery and replay do not create duplicate work or corrupt persistence.

Flow:

- replay the same top-level Slack message
- replay a thread reply
- replay a `codex_choice:*` action
- replay a merge confirmation

Required assertions:

- no duplicate worktree or duplicate turn is created
- no second merge is applied
- persisted state remains coherent and idempotent
- Slack responses make stale or replayed operations understandable to the user

### 4. Real Merge And Worktree Workflow Scenario

Run a realistic change in a linked worktree, then merge back to the base branch from the repo root.

Flow:

1. Create a temp git repo with realistic initial content.
2. Run the router scenario so the scripted agent makes changes in a linked worktree.
3. Ask for merge preview and merge confirm through the real action path.
4. Assert the merge result in git and the router's post-merge persisted state.

Negative sub-scenarios:

- merge conflict
- stale merge confirmation
- missing worktree path
- source branch already gone

Required assertions:

- root branch content changes as expected on success
- persisted thread state returns to repo-root/base-branch semantics
- stale or invalid merge attempts do not mutate state incorrectly

### 5. App-Server Transport Torture Scenario

The scripted child-process App Server must support abnormal but valid transport behavior:

- split one JSON message across multiple stdout writes
- batch several JSON messages into a single write
- write stderr noise alongside stdout traffic
- exit during an outstanding request
- emit late notifications near shutdown

Required assertions:

- the router/client stack does not misparse or deadlock
- outstanding requests fail in a controlled way
- persisted thread state remains coherent after transport failures
- restart and rebind behavior stays available after process churn

### 6. System-Level Recovery Matrix

Seed a real store on disk with a mixed set of thread states, then boot the real router and assert recovery semantics in one pass.

Required assertions:

- `idle` remains `idle`
- recoverable active states move to `interrupted`
- stale flags and `activeTurnId` cleanup are applied consistently
- recovery notices target only the latest persisted restart intent where that singleton behavior exists

### 7. Optional Live-Codex Toy-App Scenario

This scenario is intentionally more realistic and more expensive than the deterministic suite. It should be documented as a supplemental local-only check, not the main passing gate.

Flow:

1. Boot the real router with mocked Slack transport and a real temp project.
2. Route a top-level Slack task to a live Codex worker agent rather than the scripted test agent.
3. Let that worker complete a small toy-app task across multiple rounds through the same mocked Slack thread model used by the router.
4. Capture the full transcript, resulting files, and git state.
5. Dispatch a separate live Codex judge agent with a strict evaluation rubric and the captured artifacts.
6. Treat the judge output as valid only if it references the provided evidence and returns a structured pass/fail result.

Required constraints:

- the scenario must be env-gated and clearly excluded from the deterministic required suite
- the worker agent should operate through the router contract, not through direct hidden setup shortcuts
- the judge agent should not invent its own success criteria; it must be bound to a repo-defined rubric
- the test harness should still record objective signals such as exit status, produced files, and git diff

Required assertions:

- the live worker is able to complete at least one toy-app build through the router-mediated interaction path
- the recorded artifacts are sufficient for a second agent to evaluate the outcome
- the judge returns a structured verdict grounded in the artifact set
- objective test harness checks and judge verdict are both surfaced in the final report

## Implementation Shape

The implementation should be split into parallel lanes with disjoint write ownership.

### Lane A: Scenario Harness And Scripted Agent

Own:

- real-integration scenario harness helpers
- deterministic child-process scripted agent or app-server fixtures
- toy-app build scenario tests

Responsibilities:

- make the child-process fixture capable of real file edits and resumable scripted workflows
- expose enough observability to assert requests, notifications, and file outcomes

### Lane B: Git, Worktree, And Merge Scenarios

Own:

- real repo fixtures
- merge/worktree scenario tests
- negative merge and worktree cases tied to persisted router behavior

Responsibilities:

- ensure assertions cover both git outcomes and router-store outcomes
- force realistic failures, not only happy-path merges

### Lane C: Process, Launcher, And Restart Scenarios

Own:

- launcher-mediated restart tests
- child-process death and restart scenarios
- system-level recovery matrix tests

Responsibilities:

- verify process generation boundaries explicitly
- prove stale rebind and recovery behavior under actual restart conditions

### Lane D: Review And Bug-Fix Integration

Own:

- review of each lane's behavior against the approved design
- synthesis of surfaced production bugs
- controller-led integration and verification

Responsibilities:

- keep the heavy tests honest
- ensure production fixes land with the failing tests that exposed them

## Expected Production Bug Classes

The campaign should assume that at least some of these bug classes are likely to surface:

- stale-thread rebind restores the wrong persisted fields after partial failure
- duplicate Slack deliveries start duplicate turns or duplicate worktrees
- recovery notice targeting is wrong when restart intent is overwritten
- merge confirmation validation accepts replayed or stale state
- child-process framing or shutdown races leak promises or leave incorrect state
- worktree cleanup and missing-path behavior disagree with persisted router state
- restart around `awaiting_user_input` leaves actions usable when they should be stale
- process restart loses message-to-thread continuity under real persisted recovery

The design does not promise a specific bug count. It does require aggressively searching for these classes and fixing real defects as they are found.

## Test Commands

The end-state command set should be:

- `npm --prefix v2 run build`
- `npm --prefix v2 test`
- `npm --prefix v2 run coverage`
- `npm --prefix v2 run test:real-integration`

If optional live-Codex smokes are added, they must use a separate clearly documented command or env-gated path.

Recommended shape:

- `npm --prefix v2 run test:real-integration`
  deterministic heavy real-integration suite
- `npm --prefix v2 run test:live-codex`
  optional env-gated realism checks using live Codex worker and judge agents

## Verification Standard

The campaign is complete only when all of the following are true:

- heavy end-to-end scenario tests exist, not just additional seam tests
- those scenarios include restart, replay, and failure-heavy conditions
- surfaced production defects are fixed or explicitly documented as blockers
- the full `v2` build and both test suites pass
- the new architecture and commands are documented for future contributors

## Risks And Mitigations

### Risk: Scenario fixtures become unrealistic

Mitigation:

- keep the child-process fixture protocol-compatible with the real app-server transport
- drive real file edits and persisted state, not purely synthetic callbacks

### Risk: Tests become slow but still shallow

Mitigation:

- prefer a smaller number of broad, high-signal scenarios over many narrow tests
- require each heavy scenario to cover several real modules and at least one failure condition

### Risk: Heavy tests become hard to debug

Mitigation:

- retain fast in-process integrations as a localization layer
- make helpers expose structured logs, request traces, and filesystem assertions

### Risk: Optional live-Codex tests distract from deterministic confidence

Mitigation:

- keep them out of the required passing path
- document them as supplemental realism checks only

## Success Criteria

- A contributor can read this spec and understand why the previous test passes were insufficient.
- The repo gains genuinely heavy real-integration scenarios that cover a realistic toy-app build and restart survival.
- The suite can catch bugs in production code that earlier lighter tests missed.
- Confidence in `v2` is anchored by deterministic end-to-end proofs rather than optimistic seams.
