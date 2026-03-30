# Slack-Codex Project Router Design

Date: 2026-03-29

## Overview

This repository is the control-plane project for a Slack-driven Codex workflow running on one Mac. It does not serve as a project template for downstream repositories. Instead, it hosts the Slack bot integration, local orchestration logic, state storage, and operational configuration required to route Slack conversations to arbitrary local project repositories.

The target user experience is:

- one Slack bot for the whole workspace
- arbitrarily many private Slack channels
- each project channel mapped to one local project path
- each Slack thread mapped to one Codex session
- multiple concurrent tasks per project via separate threads
- follow-up messages in a thread resume the existing Codex session
- if a new follow-up arrives while that thread is already running, the new message interrupts the current run and becomes the latest instruction

## Goals

- Let the user talk to Codex from a phone through Slack.
- Use one Slack bot to manage multiple local projects.
- Keep project routing simple: one private channel corresponds to one local project path.
- Preserve task continuity through native Codex session resume.
- Support concurrent work across projects and across multiple threads within one project.
- Keep Slack-specific configuration and orchestration code out of downstream repositories.

## Non-Goals

- Do not make this repository a scaffold or template for downstream projects.
- Do not require downstream repositories to carry Slack bot code, Slack secrets, or orchestration config.
- Do not support arbitrary shell passthrough from Slack.
- Do not support multi-user access in the initial version.
- Do not support multiple simultaneous active Codex runs within the same Slack thread.

## Slack Surface

### Channel Model

- One Slack app and one bot user are used for the whole workspace.
- Each private Slack channel corresponds to one project.
- Only registered project channels are handled by the bot.
- Unregistered channels are ignored or rejected with a short explanation.

### Thread Model

- A top-level message in a project channel starts a new task.
- The bot replies in a Slack thread and all subsequent progress and results for that task stay in that thread.
- Replies inside that thread are treated as follow-ups to the same task/session.

This yields the routing model:

- `channel_id -> project_path`
- `thread_ts -> codex_session_id`

## Codex Session Model

Codex native session persistence is the source of conversational continuity.

### Session Lifecycle

- The first top-level message in a thread starts a fresh Codex session for the channel's mapped project path.
- The orchestration layer records the returned Codex session id.
- Any follow-up reply in the same Slack thread resumes that same session with `codex exec resume <session_id>`.

### Reason for Native Resume

Using native Codex resume is preferable to building a custom transcript-summary layer because:

- session continuity is owned by Codex itself
- follow-up behavior is simpler and less error-prone
- the local database only needs orchestration state, not conversation reconstruction

## Concurrency and Interrupt Semantics

### Concurrency Rules

- Multiple project channels may have active work at the same time.
- Multiple top-level threads in the same project channel may run at the same time.
- Each Slack thread may have at most one active Codex process at a time.

### Limits

Initial limits should be configurable:

- global active job cap, default `4`
- per-project active job cap, default `2`
- per-thread active job cap, fixed at `1`

### Follow-Up While Running

If a follow-up message arrives in a thread that already has a running Codex process:

- the bridge interrupts the current run
- the bridge starts a new run against the same Codex session
- the latest follow-up becomes the active instruction
- the bot posts a short in-thread status update indicating the prior run was interrupted

Recommended policy for bursty input in one thread:

- keep only the newest pending follow-up
- drop older superseded pending follow-ups in that same thread

This provides phone-friendly behavior where the latest correction or refinement wins without creating ambiguous same-thread concurrency.

## Security Model

### Trust Boundary

The daemon runs on the user's Mac under the user's normal macOS account. Because the user explicitly chose fully remote operation without local approval prompts, this setup effectively grants remote control over the files and commands accessible to that account through the bot's application logic.

This risk is acceptable only if it is understood explicitly.

### Guardrails

- Single-user allowlist based on Slack user id.
- Private project channels only.
- Only registered channel-to-project mappings are allowed.
- No arbitrary path selection from Slack messages.
- No raw shell command mode.
- Hard timeout per run.
- Support operational control commands such as `status`, `cancel`, `diff`, and `what changed`.
- Append-only logs for auditability.

Application-layer restrictions should limit Codex runs to the configured project path, but these restrictions do not change the underlying trust boundary of the macOS user account.

## Project and Repository Model

### Control Plane Repository

This repository hosts the shared Slack-Codex control plane:

- Slack bot integration
- channel/project registry
- Codex orchestration and subprocess management
- local state database
- launchd configuration
- logs and operational configuration

### Downstream Repositories

Downstream repositories remain normal repositories on disk. They do not need to know about:

- Slack bot setup
- Slack tokens
- channel mapping details
- Codex orchestration internals

They are simply targets that the control plane routes into based on channel configuration.

## Runtime Architecture

### Local Service

Run a background daemon on this Mac using `launchd`.

Recommended implementation language: Python.

Reasons:

- Slack Bolt support is mature
- subprocess management is straightforward
- SQLite integration is simple
- launchd integration is easy to operationalize

### Slack Integration

Use Slack Socket Mode instead of public HTTP events.

Reasons:

- no inbound public webhook server is required
- no tunnel or reverse proxy is needed
- better fit for a laptop-hosted personal control plane

Required Slack app capabilities:

- bot token
- app-level token with Socket Mode support
- bot access to registered private project channels

### Job Execution

Each task execution is run as a Codex subprocess scoped to the mapped project path.

A job should:

- set the working directory to the mapped project path
- run Codex in non-interactive mode
- stream machine-readable output where possible
- store the resulting session id for future thread resumes

Follow-ups should:

- look up the thread's stored session id
- interrupt any current run for that thread if needed
- invoke `codex exec resume <session_id>` with the latest message

## State Model

Persist only orchestration state needed to route, resume, and manage tasks.

### Project Table

Fields:

- `channel_id`
- `project_name`
- `project_path`
- `enabled`
- `max_concurrent_jobs`

### Thread Session Table

Fields:

- `thread_ts`
- `channel_id`
- `codex_session_id`
- `status`
- `last_user_message_ts`
- `created_at`
- `updated_at`

### Job Table

Fields:

- `job_id`
- `thread_ts`
- `pid`
- `state`
- `started_at`
- `ended_at`
- `exit_code`
- `interrupted`
- `log_path`
- `last_result_summary`

Recommended storage: SQLite.

## User Experience

### Starting a Task

In a project channel, the user sends a top-level message such as:

- "inspect this repo and explain it"
- "fix the failing tests"
- "add a README and a simple FastAPI app"

The bot:

- acknowledges quickly
- creates or uses the message thread
- posts progress updates in that thread
- posts a concise final summary on completion

### Following Up

In the same thread, the user can send:

- "actually do it without touching CI"
- "only change the backend"
- "show me what changed"

The bot routes that follow-up into the same Codex session.

### Control Messages

The initial version should support:

- `status`
- `cancel`
- `show diff`
- `what changed`

These are thread-aware commands and should operate on the thread where they are sent.

## Failure Handling

The daemon should handle these cases explicitly:

- channel is not registered
- sender is not the allowed Slack user
- project path does not exist
- Codex process exits non-zero
- Codex process times out
- follow-up arrives during an active run
- Slack delivery errors or reconnects

User-facing responses should be short and operationally clear.

## Testing Strategy

Testing should cover:

- channel-to-project routing
- thread-to-session persistence
- first-run session creation
- follow-up resume flow
- same-thread interruption behavior
- per-project and global concurrency limits
- command handling for `status`, `cancel`, `show diff`, and `what changed`
- daemon recovery after restart using persisted state

Include both unit tests and at least one end-to-end local integration path with a mocked Slack event stream and a stubbed Codex runner.

## Operational Notes

- Prefer private channels over public channels.
- Each registered project path should ideally be a Git repository.
- The control-plane repo is separate from downstream repos and should have its own git history, tests, and deployment/runtime configuration.
- launchd should keep the service alive across reboots and user logins as required by the final deployment choice.

## Recommended Implementation Sequence

1. Initialize this control-plane repository and commit this design.
2. Build the project registry and state database.
3. Implement Slack event intake and channel/thread routing.
4. Implement Codex subprocess launch for new threads.
5. Implement native session resume for follow-ups.
6. Implement same-thread interruption behavior.
7. Add control commands and status reporting.
8. Add launchd packaging and operational docs.
9. Verify against at least two local project directories.

## Open Decisions Resolved in This Design

- Use one bot for all projects.
- Use private channels, not DMs, as the project surface.
- Map one channel to one project path.
- Map one Slack thread to one Codex session.
- Use native Codex resume instead of custom transcript summaries.
- Allow concurrent work across channels and across threads within one channel.
- Interrupt active same-thread runs when a newer follow-up arrives.
- Keep this repository as the control plane only, not as a downstream project template.
