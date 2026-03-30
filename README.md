# Slack Codex Router

This repository now boots the Node/TypeScript `v2` router by default:

- `legacy/v1` contains the archived Python router.
- `v2` is the active router implementation.
- `scripts/start-router.sh` builds `v2` and launches `v2/dist/bin/launcher.js`.
- `legacy/v1/scripts/start-router-v1.sh` remains available as the fallback path.

## Setup

1. Install the Node dependencies for `v2`:

```bash
npm --prefix v2 install
```

2. Create local configuration:

```bash
cp .env.example .env
cp legacy/v1/config/projects.example.yaml config/projects.yaml
```

3. Edit `.env` and `config/projects.yaml` with real values before starting the service.

The `v2` router reuses the existing repo-root `.env`. Relative paths are still supported:

- `SCR_PROJECTS_FILE`, `SCR_STATE_DB`, and `SCR_LOG_DIR` resolve relative to the repo root when started by the wrapper.
- Project `path` entries in `config/projects.yaml` resolve relative to that YAML file.

## Run

Start the launcher through the root wrapper:

```bash
scripts/start-router.sh
```

The wrapper builds `v2`, then starts `node v2/dist/bin/launcher.js`.

## Restart Behavior

- The Slack `Restart router` control is intended to trigger a graceful worker exit.
- The launcher is responsible only for process restart, not Slack or App Server logic.
- On boot, `v2` reloads persisted thread mappings and can post a short recovery update back to the requesting Slack thread.

## Validation

Before treating `v2` as the primary router in a real channel, validate it in a private Slack channel:

1. start a top-level task
2. reply in-thread and confirm the existing App Server thread is reused
3. trigger a Block Kit choice prompt and confirm the buttons render correctly
4. trigger `Restart router` and confirm the thread receives a recovery message
5. confirm a second Slack thread can run concurrently once Task 7 worktree wiring is connected end-to-end
6. confirm `Merge to main` shows a confirmation card

## Legacy Fallback

To fall back to the archived Python router temporarily, either:

```bash
scripts/start-router.sh --legacy
```

or:

```bash
SCR_ROUTER_LEGACY=1 scripts/start-router.sh
```
