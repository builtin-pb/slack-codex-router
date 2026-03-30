from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppConfig:
    slack_bot_token: str
    slack_app_token: str
    allowed_user_id: str
    projects_file: Path
    state_db: Path
    log_dir: Path
    global_concurrency: int
    run_timeout_seconds: int
    thread_id_timeout_seconds: float


def load_config() -> AppConfig:
    return AppConfig(
        slack_bot_token=os.environ["SLACK_BOT_TOKEN"],
        slack_app_token=os.environ["SLACK_APP_TOKEN"],
        allowed_user_id=os.environ["SLACK_ALLOWED_USER_ID"],
        projects_file=Path(os.environ["SCR_PROJECTS_FILE"]),
        state_db=Path(os.environ["SCR_STATE_DB"]),
        log_dir=Path(os.environ["SCR_LOG_DIR"]),
        global_concurrency=int(os.environ.get("SCR_GLOBAL_CONCURRENCY", "4")),
        run_timeout_seconds=int(os.environ.get("SCR_RUN_TIMEOUT_SECONDS", "1800")),
        thread_id_timeout_seconds=float(os.environ.get("SCR_THREAD_ID_TIMEOUT_SECONDS", "15")),
    )
