# Slack Codex Router v2 Test Architecture Design

Date: 2026-03-30

## Overview

This design strengthens the active `v2` test strategy so the suite no longer relies mainly on mocked seam tests with weak runtime confidence.

The goal is to build a layered `v2` test pyramid:

- unit tests for narrow logic and edge cases
- submodule contract tests for boundary behavior
- in-process integration tests that boot the real router stack with controlled fake edges
- process-level smoke tests for launcher and boot behavior
- repeatable coverage reporting so numeric coverage and runtime confidence move together

The design does not touch `legacy/v1`. All new work targets the active `v2` TypeScript implementation.

## Goals

- Increase `v2` coverage in the lowest-covered runtime and bootstrap files.
- Add integrated tests that exercise real interactions across multiple `v2` modules.
- Keep failures localizable by preserving clear unit and seam tests beneath the larger integration tests.
- Add a reusable test harness so new runtime flows can be tested without rebuilding fixtures in each file.
- Add a stable coverage command for `v2`.
- Preserve fast local feedback; integrated tests should still run in seconds, not minutes.

## Non-Goals

- Do not add real-network Slack tests.
- Do not depend on live Codex App Server or real bot credentials in CI-style tests.
- Do not chase 100% coverage as an end in itself.
- Do not rewrite the router architecture just to make testing easier.
- Do not introduce heavy browser-style E2E frameworks where an in-process harness is sufficient.

## Primary Decisions

- Keep the existing test suite, but reorganize the strategy around explicit layers instead of mostly mocked module tests.
- Prefer an in-process integration harness over external E2E infrastructure for the first major test push.
- Add process smoke tests only where child-process lifecycle is the behavior under test.
- Treat coverage gaps in `src/bin/*`, `src/router/events.ts`, `src/config.ts`, and adjacent runtime helpers as first-class targets.
- Add shared `v2/test/helpers/*` fixtures if they reduce duplication and make integrated tests easier to extend.
- Add a native `v2` coverage script so instrumentation is part of the repo instead of ad hoc local commands.

## Current Problems

The current `v2` suite has three weaknesses:

1. Coverage is respectable overall, but thin in operational entrypoints.
2. Many tests mock the exact dependencies whose interaction is the real production risk.
3. There is little evidence that the real runtime wiring works across store, router service, Slack registration, runtime event bridging, and process lifecycle in one flow.

The result is a suite that is useful for regression protection but still too optimistic about integrated runtime behavior.

## Target Test Pyramid

### Layer 1: Unit Tests

These cover pure or mostly pure logic:

- config parsing and path resolution
- event mapping and normalization
- render helpers and block generation
- launcher restart decision logic
- repository-status parsing

These tests should stay narrow and cheap. Their job is to pin local logic and edge cases with minimal fixture overhead.

### Layer 2: Submodule Contract Tests

These cover boundary modules with realistic local collaborators but not the whole runtime:

- `app_server/client.ts` request-response framing
- `app_server/process.ts` line delivery and child exit behavior
- `router/service.ts` persistence and routing decisions with a real `RouterStore`
- `runtime/restart.ts` persistence contract

These tests should use real local state where cheap and mock only external edges.

### Layer 3: In-Process Integration Tests

These are the most important new layer.

The harness should boot a real `RouterStore`, real `RouterService`, real runtime startup, and real Slack handler registration. External systems remain fake but stateful:

- fake Slack app object that records `event`, `action`, and `chat.postMessage`
- fake App Server process that emits lines and lifecycle events
- fake App Server client edge or controllable test double that simulates notifications and request calls
- temp project registry and temp sqlite store

The integration harness must be able to prove flows such as:

- top-level Slack message creates thread mapping and starts a turn
- Slack reply in-thread reuses the existing mapping
- App Server notification updates store state and posts rendered Slack output
- interactive Slack actions call back into the real router service
- restart recovery reloads persisted mappings and posts recovery output

The important property is that these tests cross multiple real `v2` modules in one run.

### Layer 4: Process Smokes

These validate behaviors that should not be proven only with mocks:

- `src/bin/launcher.ts` child-worker spawn and exit propagation
- `src/bin/router.ts` boot failure and startup behavior under controlled environment
- wrapper-level restart/exit-code behavior where child process semantics matter

These tests should use short-lived child processes and fixture scripts, not real services.

They should stay few in number and high in signal.

## Harness Design

### Shared Test Helpers

Add reusable helpers under `v2/test/helpers/` for:

- temporary repo/project registry creation
- temporary env setup and restoration
- fake Slack app with captured handlers and sent messages
- controllable fake App Server transport or runtime edge
- helper assertions for posted Slack messages and persisted thread state

The helpers should be intentionally small. They exist to remove duplication and make integrated tests readable.

### Integration Harness Shape

The main harness should return:

- `store`
- `routerService`
- `slackApp`
- registered message handler and action handlers
- fake app-server controls for emitting notifications and resolving calls
- cleanup function

This lets tests drive the system through the same interfaces production code uses, while still avoiding real Slack/App Server dependencies.

## Coverage Strategy

Coverage improvement should be targeted, not purely numeric.

Priority files:

- `v2/src/bin/launcher.ts`
- `v2/src/bin/router.ts`
- `v2/src/router/events.ts`
- `v2/src/config.ts`
- any helper file added to support integrated runtime behavior

Success is not just a higher total percentage. Success means the low-confidence operational files gain meaningful assertions and integrated flows.

## Coverage Tooling

`v2/package.json` should expose a stable coverage command, using Vitest native coverage support and the required provider dependency.

Expected commands:

- `npm --prefix v2 test`
- `npm --prefix v2 run coverage`

Coverage output should remain local-file based and not require extra services.

## Verification Strategy

The final verification bar for this test push is:

1. `npm --prefix v2 test` passes.
2. `npm --prefix v2 run coverage` passes.
3. Coverage improves materially in entrypoint/runtime files, not just in already-well-covered modules.
4. At least one integration test proves a real multi-module runtime message flow.
5. At least one process smoke test proves launcher or router boot behavior through child-process execution.

## Risks And Mitigations

### Risk: Integration tests become brittle

Mitigation:

- keep the harness stateful but simple
- avoid asserting every intermediate detail
- assert stable contracts: persisted state, registered handlers, outbound Slack messages, exit codes

### Risk: Too much mocking remains inside the integration layer

Mitigation:

- prefer real `RouterStore`, real `RouterService`, real `startRouterRuntime`, and real action registration
- only fake true external boundaries

### Risk: Process smoke tests become slow or flaky

Mitigation:

- keep them short-lived
- use fixture scripts with deterministic exits
- test only lifecycle semantics, not full runtime business logic

## Implementation Shape

The work should proceed in parallel across mostly independent slices:

1. Low-level coverage expansion for undercovered pure/runtime helper files.
2. Shared integration harness creation plus integrated runtime-flow tests.
3. Process smoke coverage for launcher/router entrypoints.
4. Coverage tooling and final suite verification.

Parallel work is appropriate because these write scopes can be kept mostly separate with clear ownership.

## Success Criteria

- `v2` has a clear layered test strategy instead of mostly seam tests.
- Coverage rises meaningfully, especially in operational entrypoints.
- The repo gains reusable fixtures for future integration tests.
- Integrated runtime behavior is tested across real `v2` modules.
- The suite remains fast enough for normal development use.
