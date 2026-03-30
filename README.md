# Slack Codex Router

This repository is in a cutover state:

- `legacy/v1` contains the archived Python router.
- `v2` is the active rewrite target.
- `scripts/start-router.sh` currently delegates to `legacy/v1/scripts/start-router-v1.sh` because `v2` is not ready yet.

## Current v1 Setup

1. Install dependencies:

```bash
uv sync --dev
```

2. Create local configuration:

```bash
cp .env.example .env
cp legacy/v1/config/projects.example.yaml config/projects.yaml
```

3. Edit `.env` and `config/projects.yaml` with real values before starting the service.

Relative paths are still supported:

- `SCR_PROJECTS_FILE`, `SCR_STATE_DB`, and `SCR_LOG_DIR` resolve relative to the repo root when started by the wrapper.
- Project `path` entries in `config/projects.yaml` resolve relative to that YAML file.

## Run

Start or restart the current archived `v1` router through the temporary root wrapper:

```bash
scripts/start-router.sh
```

The root wrapper prints that `v2` is not ready yet, then delegates to the archived `v1` wrapper.
