# Slack Codex Router v2 Design

Date: 2026-03-30

## Overview

This design replaces the current Slack Codex router with a breaking `v2` centered on Codex App Server instead of `codex exec` subprocess wrapping.

The primary goal is a phone-first Slack control plane that feels as close as possible to normal Codex CLI behavior:

- no router-authored preflight by default
- no synthetic workflow stages imposed by Slack
- Codex/App Server remains authoritative for planning, questioning, review mode, and approvals
- Slack renders Codex output and adds native controls only where that improves usability

The design also adds safe parallel task execution by isolating each top-level Slack task thread in its own Git worktree and provides a simple Slack-native `Merge to main` action with a required confirmation card.

The existing Slack bot/app must be reused through the current `.env` configuration so the user does not need to create or install a new bot.

## Goals

- Preserve normal Codex interaction patterns inside Slack threads.
- Use Codex App Server as the execution and event authority.
- Keep Slack free-text replies as the primary interaction mode.
- Use Block Kit controls when Codex clearly asks for structured input or when Slack-native controls are better than typed commands.
- Support multiple concurrent Codex tasks in the same repo without filesystem or branch collisions.
- Make richer App Server progress easy to add later by rendering more event types rather than changing control flow.
- Reuse the current Slack bot credentials and allowed-user setup from `.env`.
- Support clean restart recovery for active and recently completed threads.

## Non-Goals

- Do not preserve compatibility with the current router's persisted thread/session state.
- Do not build a router-owned planning workflow on top of Codex by default.
- Do not duplicate Codex transcripts or invent a second source of truth for agent state.
- Do not require the user to type long merge or handoff instructions in Slack.
- Do not assume Codex App Server itself provides a stable server-side worktree-management API for Slack clients.

## Primary Decisions

- Build `v2` as a Node-first TypeScript service.
- Use Codex App Server over stdio as the default transport.
- Treat Slack as a renderer/controller for App Server threads, not as a second agent layer.
- Map one Slack thread to one App Server thread.
- Use free-text replies as the default input surface.
- Use Block Kit controls only when Codex asks for clear options/approvals or when exposing Slack-native thread controls.
- Allocate one dedicated Git worktree per top-level Slack thread.
- Default worktrees to named auto-branches rather than detached HEAD because Slack-native merge controls are simpler and safer on named branches.
- Require one confirmation card before `Merge to main`.

## Runtime Architecture

### Core Structure

The `v2` service contains six major parts:

1. Slack event adapter
2. Codex App Server client
3. App Server event normalizer
4. Slack renderer and control-action handler
5. Worktree manager
6. Persistence and recovery store

The runtime model is:

- Slack top-level message starts a Slack task thread
- router allocates or resolves a worktree for that Slack thread
- router starts or resumes an App Server thread
- router sends `turn/start` to App Server with `cwd` pointing at the worktree
- router subscribes to App Server notifications and renders them into the Slack thread
- Slack replies become either `turn/start` or `turn/steer`
- Slack control actions map to App Server calls or worktree-management actions

### Why Node-first

The design prefers TypeScript because App Server is event-heavy and the official App Server examples and adjacent Codex SDK material are better aligned with a JS/TS integration model. This reduces bespoke client work and keeps the implementation closer to the documented protocol surface.

### Why App Server over the current subprocess model

The current router is completion-oriented. It starts Codex, waits, and posts final summaries. App Server exposes thread, turn, item, review, steer, interrupt, collaboration-mode, and user-input primitives that are much closer to the desired Slack experience.

## Configuration Compatibility

The new service must continue reading the existing Slack bot configuration from the current `.env`.

At minimum, the following existing operational assumptions must be preserved:

- same Slack bot token
- same Slack app token
- same allowed Slack user id
- same channel-to-project registry model unless later redesigned explicitly

Additional `v2` settings may be added for:

- App Server launch settings
- worktree root location
- branch naming template
- validation hooks before merge
- Slack rendering policy toggles

These are additive. They must not require setting up a new Slack app.

## Slack Interaction Model

### Core UX Rules

- Free text remains the primary interaction surface.
- The router should not reword Codex output except where Slack UI needs short control labels or fallback text.
- Slack should not inject a preflight prompt before every new task.
- Codex/App Server remains authoritative on when to ask clarifying questions, propose options, enter review mode, or request approval.

### Slack Message Types

1. Progress message
   - Plain text posted into the Slack thread from Codex/App Server output.
   - Default rendering mode.

2. Question card
   - Used when Codex clearly asks for a short answer or explicit choice.
   - Includes Block Kit buttons or select menus when options are clear enough to encode safely.
   - Always allows free-text reply as fallback.

3. Control strip
   - Slack-native controls such as `Interrupt`, `Status`, `Review`, and `What changed`.
   - These are not pseudo-prompts sent as plain user text.

### Thread Controls

The thread should expose native controls for:

- `Interrupt`
- `Status`
- `Review`
- `What changed`
- `Open diff`
- `Merge to main`
- `Archive task`

Controls may appear conditionally based on thread state.

## App Server Thread and Event Model

### Mapping Rules

- One Slack thread maps to one App Server thread.
- App Server owns turns inside that thread.
- The router persists the Slack-thread to App-Server-thread mapping.

### Runtime States

The router tracks a minimal set of states:

- `idle`
- `running`
- `awaiting_user_input`
- `interrupted`
- `failed_setup`

These are routing/rendering states only. They must not become a second semantic workflow layer over Codex.

### Turn Handling

- Use `turn/start` by default for Slack replies.
- Use `turn/steer` for short corrective in-flight updates when Codex is actively running and the reply is clearly a refinement rather than a new task.
- `Interrupt` always maps to `turn/interrupt`.
- The router must not silently cancel an active turn just because a new message arrived. Explicit interruption is clearer and closer to normal Codex behavior.

### Event Rendering Strategy

The design is intentionally event-driven. `v2` should render a small initial event set and be able to add richer App Server event types later without changing the state model.

Initial event support should include:

- agent text/messages
- plan items when emitted
- question/choice prompts
- review entry/exit
- command execution summaries where helpful
- final turn completion state

Later additions can include:

- richer reasoning summaries
- skill visibility
- command detail timelines
- file change previews
- tool progress details

The core design principle is: richer progress equals rendering more App Server items, not inventing new router logic.

## Worktree Isolation Model

### Reason for a separate layer

Codex App Server clearly supports concurrent threads and thread-scoped execution via `cwd`, but the worktree behavior described in official docs is documented on the Codex app side rather than as an App Server API contract for third-party clients. Therefore `v2` should own worktree orchestration explicitly instead of assuming App Server will manage one-worktree-per-thread automatically.

### Isolation Rule

Each top-level Slack thread receives its own dedicated Git worktree.

The router worktree manager is responsible for:

- creating the worktree
- selecting the base branch, defaulting to `main`
- selecting the checkout mode
- recording worktree path and branch metadata
- cleaning up archived or merged worktrees according to policy

### Default Branch Policy

Default to named auto-branches:

- branch template: `codex/slack/<slack-thread-ts>`

Reasons:

- easier to merge
- easier to inspect in git tooling
- easier to recover after restart
- easier to show in Slack confirmation cards

Detached HEAD may still be supported as an advanced or fallback mode, but it should not be the default if one-tap merge is a first-class requirement.

### Worktree Path Policy

Each project should have a deterministic worktree root, for example:

- `<project>/.codex-worktrees/<slack-thread-ts>/`

The router passes that worktree path to App Server as the execution `cwd`.

## Merge and Completion Flow

### Merge Control

When the work in a Slack thread is ready, the Slack thread should offer:

- `Open diff`
- `Merge to main`
- `Archive task`

Optional advanced controls such as `Create branch here` or `Keep worktree` may be added later.

### Merge Confirmation

`Merge to main` must always show one confirmation card before performing the merge.

The confirmation card should include:

- repository name
- source branch
- target branch (`main`)
- worktree cleanliness
- validation/check status when available

This is required because merging is a branch-mutating action outside the normal conversational loop and is easy to mis-tap on mobile.

### Merge Execution

The router, not Codex/App Server, owns the merge policy.

Recommended sequence:

1. user taps `Merge to main`
2. router evaluates current branch/worktree/check state
3. router shows confirmation card
4. user confirms
5. router performs the merge into local `main`
6. router posts result
7. router offers archive and worktree cleanup

This keeps coding and repository lifecycle concerns separated cleanly.

## Persistence Model

Persist:

- Slack `channel_id`
- Slack `thread_ts`
- App Server thread id
- active turn id
- current runtime state
- worktree path
- branch name
- base branch
- outstanding interactive prompt metadata
- Slack message ids used for updates and controls

Do not persist as a second source of truth:

- full Codex transcript
- synthetic router summaries of Codex state
- copied skill definitions
- synthetic workflow stages

## Recovery Model

After router restart:

1. load persisted Slack-thread records
2. reconnect to App Server
3. re-read live App Server thread state
4. re-subscribe to active threads
5. restore Slack control surfaces without replaying fake history

Recovery must prefer App Server state over local guesses.

## Failure Handling

### Slack delivery failure

Slack delivery problems must not destroy App Server state. Slack rendering retries should be isolated from thread execution state.

### App Server disconnect

If App Server disconnects, affected Slack threads should move into a degraded state. On reconnect, the router should rebuild state from App Server thread information rather than assuming the turn is lost.

### Worktree setup failure

If worktree creation or setup fails, the thread should fail before Codex begins coding. Slack should show a setup error and offer a retry action.

### Merge failure

If merge fails due to conflicts or validation conditions, the thread remains intact. The worktree and App Server thread mapping must stay recoverable, and Slack should present the failure clearly with next-step actions.

## Testing Strategy

Testing should cover:

- Slack thread to App Server thread mapping
- `turn/start` vs `turn/steer` routing
- control-action handling
- interactive Block Kit prompt rendering
- worktree allocation per top-level Slack thread
- concurrent threads in the same repository
- merge-to-main confirmation and execution
- restart recovery
- App Server disconnect/reconnect handling
- Slack rendering dedupe and update behavior

Testing should include:

- unit tests for state, routing, and worktree logic
- protocol-level tests with a mocked App Server stream
- end-to-end tests against a real private Slack channel and the existing bot credentials before replacing the current router

## Rollout Strategy

Because this is a breaking `v2`, start with a fresh persistence schema.

Recommended phase order:

1. App Server client, Slack thread mapping, and basic turn streaming
2. interactive prompts, control strip, and explicit interrupt/review support
3. worktree manager and merge-to-main flow
4. recovery, failure hardening, and richer event rendering

`v2` should be validated in a real private Slack channel before the old router is retired.

## References

This design is based on current official OpenAI documentation as of 2026-03-30, especially:

- Codex App Server
- Codex configuration reference
- Codex app worktrees documentation

The worktree management layer is intentionally designed conservatively because the worktree behavior is documented clearly for the Codex app experience, but not as an explicit App Server API contract for external Slack clients.
