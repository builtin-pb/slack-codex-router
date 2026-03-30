# Slack Codex Router

Slack Codex Router is a local control-plane service that maps private Slack channels to local project directories and routes Slack threads into Codex sessions on this Mac.

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

## Run

Start or restart the background service in one command:

```bash
scripts/start-router.sh
```

## launchd

1. Make the startup wrapper executable:

```bash
chmod +x scripts/start-router.sh
```

2. Start or restart it:

```bash
scripts/start-router.sh
```

The wrapper installs or refreshes the LaunchAgent in `~/Library/LaunchAgents`, loads the required environment variables from `.env`, and starts the router under `launchd`.
