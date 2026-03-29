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

3. Edit `.env` and `config/projects.yaml` with real values before starting the service.

## Run

Run in the foreground:

```bash
uv run python -m slack_codex_router.main run
```

## launchd

1. Make the wrapper executable:

```bash
chmod +x scripts/run-router.sh
```

2. Load the service into your user launchd session:

```bash
launchctl bootstrap gui/$(id -u) ops/com.builtin.pb.slack-codex-router.plist
```

3. Start or restart it immediately:

```bash
launchctl kickstart -k gui/$(id -u)/com.builtin.pb.slack-codex-router
```
