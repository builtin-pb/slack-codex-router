# Slack Codex Router

Slack Codex Router is a local control-plane service that maps private Slack channels to local project directories and routes Slack threads into Codex sessions on the local machine.

## Setup

1. Install dependencies:

```bash
uv sync --dev
```

2. Create local configuration:

```bash
cp .env.example .env
cp config/projects.example.yaml config/projects.yaml
```

The first copy command gives you a complete environment template to fill in locally. The second copy command gives you a complete channel/project registry template to edit for your Slack channels and project paths.

3. Edit `.env` and `config/projects.yaml` with real values before starting the service.

Relative paths are supported:

- `SCR_PROJECTS_FILE`, `SCR_STATE_DB`, and `SCR_LOG_DIR` resolve relative to the repo root when started by the wrapper.
- Project `path` entries in `config/projects.yaml` resolve relative to that YAML file.

## Run

Start or restart the service in one command:

```bash
scripts/start-router.sh
```

The wrapper auto-detects the host environment:

- macOS: installs or refreshes a user `launchd` agent.
- Linux with `systemd --user`: installs or refreshes a user service.
- Linux without `systemd`: runs the router in the foreground.

## Service Wrapper

1. Make the startup wrapper executable:

```bash
chmod +x scripts/start-router.sh
```

2. Start or restart it:

```bash
scripts/start-router.sh
```
