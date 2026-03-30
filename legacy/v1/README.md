# Slack Codex Router v1 (Archived)

This directory contains the archived Python `v1` router that previously lived at the repository root.

The repository root is being repurposed for the `v2` rewrite. Until `v2` lands, the root wrapper at `scripts/start-router.sh` delegates to `legacy/v1/scripts/start-router-v1.sh`.

`legacy/v1/scripts/start-router-v1.sh` is the historical wrapper adapted to run the archived Python package from `legacy/v1/src` while continuing to use the repo-root `.env` and `config/projects.yaml` files.
