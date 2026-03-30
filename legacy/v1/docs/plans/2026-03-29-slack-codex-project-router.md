# Slack Codex Project Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python control-plane service in this repository that runs one Slack bot on this Mac, maps private Slack channels to local project paths, maps Slack threads to native Codex sessions, enforces project/global concurrency caps, posts final summaries back to Slack, and interrupts same-thread runs when a newer follow-up arrives.

**Architecture:** The service is a Slack Socket Mode daemon backed by a small SQLite state store and a YAML project registry. A Slack top-level message starts a new Codex session in the mapped project directory, a reply in the same thread resumes that session with `codex exec resume`, and the job manager enforces one active process per thread with latest-message-wins interruption.

**Tech Stack:** Python 3.12, Slack Bolt for Python, PyYAML, SQLite (`sqlite3` stdlib), `pytest`, `uv`

---

## File Structure

- Create: `.gitignore`
- Create: `.env.example`
- Create: `pyproject.toml`
- Create: `README.md`
- Create: `config/projects.example.yaml`
- Create: `scripts/run-router.sh`
- Create: `ops/com.builtin.pb.slack-codex-router.plist`
- Create: `src/slack_codex_router/__init__.py`
- Create: `src/slack_codex_router/main.py`
- Create: `src/slack_codex_router/config.py`
- Create: `src/slack_codex_router/registry.py`
- Create: `src/slack_codex_router/store.py`
- Create: `src/slack_codex_router/codex_events.py`
- Create: `src/slack_codex_router/codex_runner.py`
- Create: `src/slack_codex_router/job_manager.py`
- Create: `src/slack_codex_router/commands.py`
- Create: `src/slack_codex_router/slack_app.py`
- Create: `tests/conftest.py`
- Create: `tests/fixtures/codex_exec_sample.jsonl`
- Create: `tests/test_smoke.py`
- Create: `tests/test_config.py`
- Create: `tests/test_store.py`
- Create: `tests/test_codex_events.py`
- Create: `tests/test_codex_runner.py`
- Create: `tests/test_job_manager.py`
- Create: `tests/test_commands.py`
- Create: `tests/test_slack_app.py`
- Create: `tests/test_integration_router.py`

## Task 1: Bootstrap the Python Project

**Files:**
- Create: `.gitignore`
- Create: `pyproject.toml`
- Create: `src/slack_codex_router/__init__.py`
- Create: `src/slack_codex_router/main.py`
- Create: `tests/test_smoke.py`

- [ ] **Step 1: Write the failing smoke test**

```python
# tests/test_smoke.py
from slack_codex_router.main import build_parser


def test_build_parser_exposes_run_subcommand() -> None:
    parser = build_parser()
    choices = parser._subparsers._group_actions[0].choices
    assert "run" in choices
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `uv run pytest tests/test_smoke.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'slack_codex_router'`

- [ ] **Step 3: Write the minimal package and CLI skeleton**

```toml
# pyproject.toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "slack-codex-router"
version = "0.1.0"
description = "Slack control plane for routing Codex sessions into local project directories"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
  "PyYAML>=6.0.2",
  "slack-bolt>=1.23.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.3.5",
]

[project.scripts]
slack-codex-router = "slack_codex_router.main:main"

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

```python
# src/slack_codex_router/__init__.py
__all__ = ["__version__"]

__version__ = "0.1.0"
```

```python
# src/slack_codex_router/main.py
from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="slack-codex-router")
    subcommands = parser.add_subparsers(dest="command")
    run_parser = subcommands.add_parser("run")
    run_parser.set_defaults(command="run")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return 0 if args.command == "run" else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

```gitignore
# .gitignore
.env
.venv/
.pytest_cache/
__pycache__/
*.pyc
state/
logs/
```

- [ ] **Step 4: Run the smoke test to verify it passes**

Run: `uv run pytest tests/test_smoke.py -q`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit the bootstrap**

```bash
git add .gitignore pyproject.toml src/slack_codex_router/__init__.py src/slack_codex_router/main.py tests/test_smoke.py
git commit -m "chore: bootstrap slack codex router package"
```

## Task 2: Add Configuration Loading and the Project Registry

**Files:**
- Create: `.env.example`
- Create: `config/projects.example.yaml`
- Create: `src/slack_codex_router/config.py`
- Create: `src/slack_codex_router/registry.py`
- Create: `tests/test_config.py`
- Modify: `src/slack_codex_router/main.py`

- [ ] **Step 1: Write the failing configuration tests**

```python
# tests/test_config.py
from pathlib import Path

from slack_codex_router.config import AppConfig, load_config
from slack_codex_router.registry import ProjectRegistry


def test_load_config_reads_required_environment(tmp_path: Path, monkeypatch) -> None:
    projects_file = tmp_path / "projects.yaml"
    state_db = tmp_path / "router.sqlite3"
    log_dir = tmp_path / "logs"
    projects_file.write_text(
        "projects:\n"
        "  - channel_id: C123\n"
        "    name: demo\n"
        "    path: /tmp/demo\n"
        "    max_concurrent_jobs: 2\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    monkeypatch.setenv("SLACK_ALLOWED_USER_ID", "U123")
    monkeypatch.setenv("SCR_PROJECTS_FILE", str(projects_file))
    monkeypatch.setenv("SCR_STATE_DB", str(state_db))
    monkeypatch.setenv("SCR_LOG_DIR", str(log_dir))

    config = load_config()

    assert config == AppConfig(
        slack_bot_token="xoxb-test",
        slack_app_token="xapp-test",
        allowed_user_id="U123",
        projects_file=projects_file,
        state_db=state_db,
        log_dir=log_dir,
        global_concurrency=4,
        run_timeout_seconds=1800,
    )


def test_project_registry_returns_project_by_channel(tmp_path: Path) -> None:
    projects_file = tmp_path / "projects.yaml"
    project_path = tmp_path / "demo"
    project_path.mkdir()
    projects_file.write_text(
        "projects:\n"
        "  - channel_id: C123\n"
        "    name: demo\n"
        f"    path: {project_path}\n"
        "    max_concurrent_jobs: 2\n",
        encoding="utf-8",
    )

    registry = ProjectRegistry.from_yaml(projects_file)
    project = registry.by_channel("C123")

    assert project.name == "demo"
    assert project.path == project_path
    assert project.max_concurrent_jobs == 2
```

- [ ] **Step 2: Run the config tests to verify they fail**

Run: `uv run pytest tests/test_config.py -q`
Expected: FAIL with `ModuleNotFoundError` for `slack_codex_router.config`

- [ ] **Step 3: Implement configuration and registry loading**

```python
# src/slack_codex_router/config.py
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
    )
```

```python
# src/slack_codex_router/registry.py
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class ProjectConfig:
    channel_id: str
    name: str
    path: Path
    max_concurrent_jobs: int


class ProjectRegistry:
    def __init__(self, projects: dict[str, ProjectConfig]) -> None:
        self._projects = projects

    @classmethod
    def from_yaml(cls, path: Path) -> "ProjectRegistry":
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        projects = {
            item["channel_id"]: ProjectConfig(
                channel_id=item["channel_id"],
                name=item["name"],
                path=Path(item["path"]),
                max_concurrent_jobs=item.get("max_concurrent_jobs", 2),
            )
            for item in raw.get("projects", [])
        }
        return cls(projects)

    def by_channel(self, channel_id: str) -> ProjectConfig | None:
        return self._projects.get(channel_id)
```

```python
# src/slack_codex_router/main.py
from __future__ import annotations

import argparse

from slack_codex_router.config import load_config
from slack_codex_router.registry import ProjectRegistry


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="slack-codex-router")
    subcommands = parser.add_subparsers(dest="command")
    run_parser = subcommands.add_parser("run")
    run_parser.set_defaults(command="run")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command != "run":
        return 1

    config = load_config()
    ProjectRegistry.from_yaml(config.projects_file)
    config.log_dir.mkdir(parents=True, exist_ok=True)
    config.state_db.parent.mkdir(parents=True, exist_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

```dotenv
# .env.example
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_ALLOWED_USER_ID=U12345678
SCR_PROJECTS_FILE=/Users/builtin.pb/Desktop/Template/config/projects.yaml
SCR_STATE_DB=/Users/builtin.pb/Desktop/Template/state/router.sqlite3
SCR_LOG_DIR=/Users/builtin.pb/Desktop/Template/logs
SCR_GLOBAL_CONCURRENCY=4
SCR_RUN_TIMEOUT_SECONDS=1800
```

```yaml
# config/projects.example.yaml
projects:
  - channel_id: C08TEMPLATE
    name: template
    path: /Users/builtin.pb/Desktop/Template
    max_concurrent_jobs: 2
```

- [ ] **Step 4: Run the config tests to verify they pass**

Run: `uv run pytest tests/test_config.py -q`
Expected: PASS with `2 passed`

- [ ] **Step 5: Commit configuration loading**

```bash
git add .env.example config/projects.example.yaml src/slack_codex_router/config.py src/slack_codex_router/registry.py src/slack_codex_router/main.py tests/test_config.py
git commit -m "feat: add router configuration and project registry"
```

## Task 3: Build the SQLite State Store

**Files:**
- Create: `src/slack_codex_router/store.py`
- Create: `tests/test_store.py`

- [ ] **Step 1: Write the failing state-store tests**

```python
# tests/test_store.py
from pathlib import Path

from slack_codex_router.store import RouterStore


def test_upsert_thread_session_persists_codex_thread_id(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")

    store.upsert_thread_session(
        thread_ts="1710000000.100000",
        channel_id="C123",
        codex_thread_id="019d38b3-48fe-7790-a2e3-d9a5f81b450a",
        status="running",
        last_user_message_ts="1710000000.100000",
    )

    session = store.get_thread_session("1710000000.100000")
    assert session["codex_thread_id"] == "019d38b3-48fe-7790-a2e3-d9a5f81b450a"
    assert session["status"] == "running"


def test_mark_job_finished_persists_summary(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    job_id = store.start_job(
        thread_ts="1710000000.100000",
        pid=4242,
        log_path=str(tmp_path / "job.log"),
    )

    store.finish_job(job_id=job_id, exit_code=0, interrupted=False, summary="READY")
    job = store.get_latest_job("1710000000.100000")

    assert job["exit_code"] == 0
    assert job["interrupted"] == 0
    assert job["last_result_summary"] == "READY"
```

- [ ] **Step 2: Run the state-store tests to verify they fail**

Run: `uv run pytest tests/test_store.py -q`
Expected: FAIL with `ModuleNotFoundError` for `slack_codex_router.store`

- [ ] **Step 3: Implement the SQLite store**

```python
# src/slack_codex_router/store.py
from __future__ import annotations

import sqlite3
from pathlib import Path


class RouterStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS thread_sessions (
                    thread_ts TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    codex_thread_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    last_user_message_ts TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS jobs (
                    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_ts TEXT NOT NULL,
                    pid INTEGER NOT NULL,
                    state TEXT NOT NULL DEFAULT 'running',
                    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    ended_at TEXT,
                    exit_code INTEGER,
                    interrupted INTEGER NOT NULL DEFAULT 0,
                    log_path TEXT NOT NULL,
                    last_result_summary TEXT
                );
                """
            )

    def upsert_thread_session(
        self,
        *,
        thread_ts: str,
        channel_id: str,
        codex_thread_id: str,
        status: str,
        last_user_message_ts: str,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO thread_sessions (
                    thread_ts, channel_id, codex_thread_id, status, last_user_message_ts
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(thread_ts) DO UPDATE SET
                    channel_id = excluded.channel_id,
                    codex_thread_id = excluded.codex_thread_id,
                    status = excluded.status,
                    last_user_message_ts = excluded.last_user_message_ts,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (thread_ts, channel_id, codex_thread_id, status, last_user_message_ts),
            )

    def get_thread_session(self, thread_ts: str) -> sqlite3.Row | None:
        with self._connect() as connection:
            return connection.execute(
                "SELECT * FROM thread_sessions WHERE thread_ts = ?",
                (thread_ts,),
            ).fetchone()

    def start_job(self, *, thread_ts: str, pid: int, log_path: str) -> int:
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO jobs (thread_ts, pid, log_path) VALUES (?, ?, ?)",
                (thread_ts, pid, log_path),
            )
            return int(cursor.lastrowid)

    def finish_job(self, *, job_id: int, exit_code: int, interrupted: bool, summary: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET state = ?, ended_at = CURRENT_TIMESTAMP, exit_code = ?, interrupted = ?, last_result_summary = ?
                WHERE job_id = ?
                """,
                ("interrupted" if interrupted else "finished", exit_code, int(interrupted), summary, job_id),
            )

    def get_latest_job(self, thread_ts: str) -> sqlite3.Row | None:
        with self._connect() as connection:
            return connection.execute(
                """
                SELECT * FROM jobs
                WHERE thread_ts = ?
                ORDER BY job_id DESC
                LIMIT 1
                """,
                (thread_ts,),
            ).fetchone()
```

- [ ] **Step 4: Run the state-store tests to verify they pass**

Run: `uv run pytest tests/test_store.py -q`
Expected: PASS with `2 passed`

- [ ] **Step 5: Commit the state store**

```bash
git add src/slack_codex_router/store.py tests/test_store.py
git commit -m "feat: add sqlite state store"
```

## Task 4: Add the Codex CLI Adapter and Event Parsing

**Files:**
- Create: `src/slack_codex_router/codex_events.py`
- Create: `src/slack_codex_router/codex_runner.py`
- Create: `tests/fixtures/codex_exec_sample.jsonl`
- Create: `tests/test_codex_events.py`
- Create: `tests/test_codex_runner.py`

- [ ] **Step 1: Write failing tests for Codex event parsing and command building**

```python
# tests/test_codex_events.py
from pathlib import Path

from slack_codex_router.codex_events import extract_thread_id, parse_event_lines


def test_extract_thread_id_from_exec_jsonl_fixture() -> None:
    fixture = Path("tests/fixtures/codex_exec_sample.jsonl")
    events = parse_event_lines(fixture.read_text(encoding="utf-8").splitlines())

    assert extract_thread_id(events) == "019d38b3-48fe-7790-a2e3-d9a5f81b450a"
```

```python
# tests/test_codex_runner.py
from pathlib import Path

from slack_codex_router.codex_runner import build_exec_command, build_resume_command


def test_build_exec_command_includes_json_and_output_file(tmp_path: Path) -> None:
    output_file = tmp_path / "last.txt"
    command = build_exec_command("Reply with READY.", output_file)
    assert command == [
        "codex",
        "exec",
        "--json",
        "--output-last-message",
        str(output_file),
        "Reply with READY.",
    ]


def test_build_resume_command_places_session_id_before_prompt(tmp_path: Path) -> None:
    output_file = tmp_path / "last.txt"
    command = build_resume_command("019d38b3-48fe-7790-a2e3-d9a5f81b450a", "status", output_file)
    assert command == [
        "codex",
        "exec",
        "resume",
        "--json",
        "--output-last-message",
        str(output_file),
        "019d38b3-48fe-7790-a2e3-d9a5f81b450a",
        "status",
    ]
```

- [ ] **Step 2: Run the Codex adapter tests to verify they fail**

Run: `uv run pytest tests/test_codex_events.py tests/test_codex_runner.py -q`
Expected: FAIL with `ModuleNotFoundError` for `slack_codex_router.codex_events`

- [ ] **Step 3: Implement event parsing and the command builder**

```json
{"type":"thread.started","thread_id":"019d38b3-48fe-7790-a2e3-d9a5f81b450a"}
{"type":"turn.started"}
```

```python
# src/slack_codex_router/codex_events.py
from __future__ import annotations

import json
from collections.abc import Iterable


def parse_event_lines(lines: Iterable[str]) -> list[dict[str, object]]:
    return [json.loads(line) for line in lines if line.strip()]


def extract_thread_id(events: list[dict[str, object]]) -> str | None:
    for event in events:
        if event.get("type") == "thread.started":
            thread_id = event.get("thread_id")
            return str(thread_id) if thread_id is not None else None
    return None
```

```python
# src/slack_codex_router/codex_runner.py
from __future__ import annotations

from pathlib import Path


def build_exec_command(prompt: str, output_file: Path) -> list[str]:
    return [
        "codex",
        "exec",
        "--json",
        "--output-last-message",
        str(output_file),
        prompt,
    ]


def build_resume_command(session_id: str, prompt: str, output_file: Path) -> list[str]:
    return [
        "codex",
        "exec",
        "resume",
        "--json",
        "--output-last-message",
        str(output_file),
        session_id,
        prompt,
    ]
```

```jsonl
# tests/fixtures/codex_exec_sample.jsonl
{"type":"thread.started","thread_id":"019d38b3-48fe-7790-a2e3-d9a5f81b450a"}
{"type":"turn.started"}
```

- [ ] **Step 4: Run the Codex adapter tests to verify they pass, then verify the real CLI contract**

Run: `uv run pytest tests/test_codex_events.py tests/test_codex_runner.py -q`
Expected: PASS with `3 passed`

Run: `codex exec --json --output-last-message /tmp/codex-last.txt "Reply with exactly READY."`
Expected: stdout includes a JSON line shaped like `{"type":"thread.started","thread_id":"019d38b3-48fe-7790-a2e3-d9a5f81b450a"}` and `/tmp/codex-last.txt` is created if the CLI completes successfully

- [ ] **Step 5: Commit the Codex adapter**

```bash
git add src/slack_codex_router/codex_events.py src/slack_codex_router/codex_runner.py tests/fixtures/codex_exec_sample.jsonl tests/test_codex_events.py tests/test_codex_runner.py
git commit -m "feat: add codex cli adapter"
```

## Task 5: Implement the Job Manager with Same-Thread Interruption

**Files:**
- Create: `src/slack_codex_router/job_manager.py`
- Create: `tests/test_job_manager.py`
- Modify: `src/slack_codex_router/store.py`
- Modify: `src/slack_codex_router/codex_runner.py`

- [ ] **Step 1: Write failing tests for thread interruption semantics**

```python
# tests/test_job_manager.py
from dataclasses import dataclass
from pathlib import Path

import pytest

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectConfig
from slack_codex_router.store import RouterStore


@dataclass
class FakeRun:
    thread_id: str
    pid: int
    interrupted: bool = False
    output_file: Path | None = None
    log_path: Path | None = None
    process: object | None = None


class FakeRunner:
    def __init__(self) -> None:
        self.exec_calls: list[tuple[Path, str]] = []
        self.resume_calls: list[tuple[Path, str, str]] = []
        self.current = FakeRun(thread_id="session-1", pid=1001)

    def start(self, project_path: Path, prompt: str) -> FakeRun:
        self.exec_calls.append((project_path, prompt))
        self.current = FakeRun(
            thread_id="session-1",
            pid=1001,
            output_file=project_path / ".codex-last.txt",
            log_path=project_path / ".codex-run.log",
        )
        return self.current

    def resume(self, project_path: Path, session_id: str, prompt: str) -> FakeRun:
        self.resume_calls.append((project_path, session_id, prompt))
        self.current = FakeRun(
            thread_id=session_id,
            pid=1002,
            output_file=project_path / ".codex-last.txt",
            log_path=project_path / ".codex-run.log",
        )
        return self.current

    def interrupt(self, run: FakeRun) -> None:
        run.interrupted = True


def test_follow_up_interrupts_active_run_and_reuses_same_session(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = FakeRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=2)

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="initial request",
        project=project,
    )
    manager.handle_follow_up(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000001.100000",
        prompt="latest request",
        project=project,
    )

    latest_job = store.get_latest_job("1710000000.100000")
    session = store.get_thread_session("1710000000.100000")

    assert runner.resume_calls == [(tmp_path, "session-1", "latest request")]
    assert latest_job["pid"] == 1002
    assert session["codex_thread_id"] == "session-1"


def test_project_concurrency_limit_blocks_second_top_level_thread(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    runner = FakeRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    project = ProjectConfig(channel_id="C123", name="demo", path=tmp_path, max_concurrent_jobs=1)

    manager.start_new_thread(
        channel_id="C123",
        thread_ts="1710000000.100000",
        user_message_ts="1710000000.100000",
        prompt="first task",
        project=project,
    )

    with pytest.raises(RuntimeError, match="Project concurrency limit reached"):
        manager.start_new_thread(
            channel_id="C123",
            thread_ts="1710000002.100000",
            user_message_ts="1710000002.100000",
            prompt="second task",
            project=project,
        )
```

- [ ] **Step 2: Run the job-manager tests to verify they fail**

Run: `uv run pytest tests/test_job_manager.py -q`
Expected: FAIL with `ModuleNotFoundError` for `slack_codex_router.job_manager`

- [ ] **Step 3: Implement the job manager and active-run bookkeeping**

```python
# src/slack_codex_router/job_manager.py
from __future__ import annotations

from dataclasses import dataclass

from slack_codex_router.registry import ProjectConfig
from slack_codex_router.store import RouterStore


@dataclass
class ActiveRun:
    thread_ts: str
    session_id: str
    pid: int
    run: object


class JobManager:
    def __init__(self, *, store: RouterStore, runner, global_limit: int, run_timeout_seconds: int) -> None:
        self._store = store
        self._runner = runner
        self._global_limit = global_limit
        self._run_timeout_seconds = run_timeout_seconds
        self._active_by_thread: dict[str, ActiveRun] = {}
        self._active_by_project: dict[str, set[str]] = {}

    def start_new_thread(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        user_message_ts: str,
        prompt: str,
        project: ProjectConfig,
    ) -> ActiveRun:
        if len(self._active_by_thread) >= self._global_limit:
            raise RuntimeError("Global concurrency limit reached")
        active_threads = self._active_by_project.setdefault(project.channel_id, set())
        if len(active_threads) >= project.max_concurrent_jobs:
            raise RuntimeError("Project concurrency limit reached")
        run = self._runner.start(project.path, prompt)
        self._store.upsert_thread_session(
            thread_ts=thread_ts,
            channel_id=channel_id,
            codex_thread_id=run.thread_id,
            status="running",
            last_user_message_ts=user_message_ts,
        )
        self._store.start_job(thread_ts=thread_ts, pid=run.pid, log_path=str(run.log_path))
        active = ActiveRun(thread_ts=thread_ts, session_id=run.thread_id, pid=run.pid, run=run)
        self._active_by_thread[thread_ts] = active
        active_threads.add(thread_ts)
        return active

    def handle_follow_up(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        user_message_ts: str,
        prompt: str,
        project: ProjectConfig,
    ) -> ActiveRun:
        current = self._active_by_thread.get(thread_ts)
        if current is not None:
            self._runner.interrupt(current.run)

        session = self._store.get_thread_session(thread_ts)
        session_id = str(session["codex_thread_id"])
        run = self._runner.resume(project.path, session_id, prompt)
        self._store.upsert_thread_session(
            thread_ts=thread_ts,
            channel_id=channel_id,
            codex_thread_id=session_id,
            status="running",
            last_user_message_ts=user_message_ts,
        )
        self._store.start_job(thread_ts=thread_ts, pid=run.pid, log_path=str(run.log_path))
        active = ActiveRun(thread_ts=thread_ts, session_id=session_id, pid=run.pid, run=run)
        self._active_by_thread[thread_ts] = active
        return active
```

```python
# src/slack_codex_router/codex_runner.py
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from slack_codex_router.codex_events import extract_thread_id, parse_event_lines


@dataclass
class CodexRun:
    thread_id: str
    pid: int
    process: subprocess.Popen[str]


def build_exec_command(prompt: str, output_file: Path) -> list[str]:
    return ["codex", "exec", "--json", "--output-last-message", str(output_file), prompt]


def build_resume_command(session_id: str, prompt: str, output_file: Path) -> list[str]:
    return ["codex", "exec", "resume", "--json", "--output-last-message", str(output_file), session_id, prompt]


class CodexRunner:
    def start(self, project_path: Path, prompt: str) -> CodexRun:
        return self._launch(project_path, build_exec_command(prompt, project_path / ".codex-last.txt"))

    def resume(self, project_path: Path, session_id: str, prompt: str) -> CodexRun:
        return self._launch(project_path, build_resume_command(session_id, prompt, project_path / ".codex-last.txt"))

    def interrupt(self, run: CodexRun) -> None:
        run.process.terminate()

    def _launch(self, project_path: Path, command: list[str]) -> CodexRun:
        process = subprocess.Popen(
            command,
            cwd=project_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        first_lines: list[str] = []
        assert process.stdout is not None
        while len(first_lines) < 4:
            line = process.stdout.readline()
            if not line:
                break
            first_lines.append(line.rstrip("\n"))
            thread_id = extract_thread_id(parse_event_lines(first_lines))
            if thread_id is not None:
                return CodexRun(thread_id=thread_id, pid=process.pid, process=process)
        raise RuntimeError("Codex run did not emit thread.started")
```

```python
# src/slack_codex_router/store.py
def mark_thread_status(self, thread_ts: str, status: str, last_user_message_ts: str) -> None:
    with self._connect() as connection:
        connection.execute(
            """
            UPDATE thread_sessions
            SET status = ?, last_user_message_ts = ?, updated_at = CURRENT_TIMESTAMP
            WHERE thread_ts = ?
            """,
            (status, last_user_message_ts, thread_ts),
        )
```

- [ ] **Step 4: Run the job-manager tests to verify they pass**

Run: `uv run pytest tests/test_job_manager.py -q`
Expected: PASS with `2 passed`

- [ ] **Step 5: Commit the job manager**

```bash
git add src/slack_codex_router/job_manager.py src/slack_codex_router/codex_runner.py src/slack_codex_router/store.py tests/test_job_manager.py
git commit -m "feat: add job manager with same-thread interruption"
```

## Task 6: Add Completion Reporting and Final Slack Summaries

**Files:**
- Modify: `src/slack_codex_router/codex_runner.py`
- Modify: `src/slack_codex_router/job_manager.py`
- Create: `src/slack_codex_router/slack_app.py`
- Create: `tests/test_slack_app.py`
- Modify: `src/slack_codex_router/store.py`

- [ ] **Step 1: Write failing tests for completion reporting**

```python
# tests/test_slack_app.py
from pathlib import Path

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectConfig, ProjectRegistry
from slack_codex_router.slack_app import SlackRouter
from slack_codex_router.store import RouterStore


class FakeRunner:
    def start(self, project_path: Path, prompt: str):
        output_file = project_path / ".codex-last.txt"
        output_file.write_text("Final summary from Codex", encoding="utf-8")
        return type(
            "Run",
            (),
            {"thread_id": "session-1", "pid": 1001, "process": None, "output_file": output_file, "log_path": project_path / ".codex-run.log"},
        )()

    def resume(self, project_path: Path, session_id: str, prompt: str):
        output_file = project_path / ".codex-last.txt"
        output_file.write_text("Updated final summary from Codex", encoding="utf-8")
        return type(
            "Run",
            (),
            {"thread_id": session_id, "pid": 1002, "process": None, "output_file": output_file, "log_path": project_path / ".codex-run.log"},
        )()

    def interrupt(self, run) -> None:
        return None

    def wait(self, run) -> tuple[int, str]:
        return (0, run.output_file.read_text(encoding="utf-8"))


def test_publish_completion_posts_summary_back_into_thread(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    registry = ProjectRegistry(
        {
            "C123": ProjectConfig(
                channel_id="C123",
                name="demo",
                path=tmp_path,
                max_concurrent_jobs=2,
            )
        }
    )
    manager = JobManager(store=store, runner=FakeRunner(), global_limit=4, run_timeout_seconds=1800)
    router = SlackRouter(allowed_user_id="U123", registry=registry, manager=manager, store=store)
    replies: list[str] = []

    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000000.100000",
            "text": "inspect this repo",
        },
        replies.append,
    )
    manager.complete_thread(
        "1710000000.100000",
        exit_code=0,
        summary="Final summary from Codex",
        interrupted=False,
    )
    router.publish_completion(
        channel_id="C123",
        thread_ts="1710000000.100000",
        summary="Final summary from Codex",
        interrupted=False,
        reply=replies.append,
    )

    assert replies[-1] == "Finished Codex run.\n\nFinal summary from Codex"
```

- [ ] **Step 2: Run the completion-reporting tests to verify they fail**

Run: `uv run pytest tests/test_slack_app.py -q`
Expected: FAIL until the router and manager expose completion-reporting helpers

- [ ] **Step 3: Implement completion handling and final summary formatting**

```python
# src/slack_codex_router/codex_runner.py
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from slack_codex_router.codex_events import extract_thread_id, parse_event_lines


@dataclass
class CodexRun:
    thread_id: str
    pid: int
    process: subprocess.Popen[str]
    output_file: Path
    log_path: Path


class CodexRunner:
    def start(self, project_path: Path, prompt: str) -> CodexRun:
        output_file = project_path / ".codex-last.txt"
        log_path = project_path / ".codex-run.log"
        return self._launch(project_path, build_exec_command(prompt, output_file), output_file, log_path)

    def resume(self, project_path: Path, session_id: str, prompt: str) -> CodexRun:
        output_file = project_path / ".codex-last.txt"
        log_path = project_path / ".codex-run.log"
        return self._launch(project_path, build_resume_command(session_id, prompt, output_file), output_file, log_path)

    def wait(self, run: CodexRun, timeout_seconds: int) -> tuple[int, str]:
        with run.log_path.open("a", encoding="utf-8") as log_file:
            if run.process.stdout is not None:
                for line in run.process.stdout:
                    log_file.write(line)
            try:
                exit_code = run.process.wait(timeout=timeout_seconds)
            except subprocess.TimeoutExpired:
                run.process.kill()
                return (124, "Codex run timed out before completion.")
        summary = run.output_file.read_text(encoding="utf-8").strip() if run.output_file.exists() else ""
        return exit_code, summary

    def interrupt(self, run: CodexRun) -> None:
        run.process.terminate()

    def _launch(self, project_path: Path, command: list[str], output_file: Path, log_path: Path) -> CodexRun:
        process = subprocess.Popen(
            command,
            cwd=project_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        first_lines: list[str] = []
        assert process.stdout is not None
        while len(first_lines) < 4:
            line = process.stdout.readline()
            if not line:
                break
            first_lines.append(line.rstrip("\n"))
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as log_file:
                log_file.write(line)
            thread_id = extract_thread_id(parse_event_lines(first_lines))
            if thread_id is not None:
                return CodexRun(
                    thread_id=thread_id,
                    pid=process.pid,
                    process=process,
                    output_file=output_file,
                    log_path=log_path,
                )
        raise RuntimeError("Codex run did not emit thread.started")
```

```python
# src/slack_codex_router/job_manager.py
from __future__ import annotations

from dataclasses import dataclass

from slack_codex_router.registry import ProjectConfig
from slack_codex_router.store import RouterStore


@dataclass
class ActiveRun:
    thread_ts: str
    session_id: str
    pid: int
    run: object


class JobManager:
    def __init__(self, *, store: RouterStore, runner, global_limit: int, run_timeout_seconds: int) -> None:
        self._store = store
        self._runner = runner
        self._global_limit = global_limit
        self._run_timeout_seconds = run_timeout_seconds
        self._active_by_thread: dict[str, ActiveRun] = {}
        self._active_by_project: dict[str, set[str]] = {}

    def wait_for_thread(self, thread_ts: str) -> tuple[int, str, bool]:
        active = self._active_by_thread.get(thread_ts)
        if active is None:
            raise RuntimeError(f"No active run found for thread {thread_ts}")
        exit_code, summary = self._runner.wait(active.run, timeout_seconds=self._run_timeout_seconds)
        interrupted = active.run.interrupted if hasattr(active.run, "interrupted") else False
        self.complete_thread(thread_ts, exit_code=exit_code, summary=summary, interrupted=interrupted)
        return exit_code, summary, interrupted

    def complete_thread(self, thread_ts: str, *, exit_code: int, summary: str, interrupted: bool) -> None:
        latest_job = self._store.get_latest_job(thread_ts)
        if latest_job is None:
            raise RuntimeError(f"No job found for thread {thread_ts}")
        self._store.finish_job(
            job_id=int(latest_job["job_id"]),
            exit_code=exit_code,
            interrupted=interrupted,
            summary=summary,
        )
        session = self._store.get_thread_session(thread_ts)
        self._store.mark_thread_status(
            thread_ts,
            "interrupted" if interrupted else "finished",
            str(session["last_user_message_ts"]),
        )
        active = self._active_by_thread.pop(thread_ts, None)
        if active is not None:
            self._active_by_project.get(str(session["channel_id"]), set()).discard(thread_ts)
```

```python
# src/slack_codex_router/slack_app.py
from __future__ import annotations

import threading

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler


class SlackRouter:
    def __init__(self, *, allowed_user_id: str, registry, manager, store) -> None:
        self._allowed_user_id = allowed_user_id
        self._registry = registry
        self._manager = manager
        self._store = store

    def _watch_completion(self, *, channel_id: str, thread_ts: str, reply) -> None:
        _, summary, interrupted = self._manager.wait_for_thread(thread_ts)
        self.publish_completion(
            channel_id=channel_id,
            thread_ts=thread_ts,
            summary=summary,
            interrupted=interrupted,
            reply=reply,
        )

    def publish_completion(
        self,
        *,
        channel_id: str,
        thread_ts: str,
        summary: str,
        interrupted: bool,
        reply,
    ) -> None:
        if interrupted:
            reply("Previous Codex run was interrupted.")
            return
        reply(f"Finished Codex run.\n\n{summary}" if summary else "Finished Codex run.")

    def start_completion_watch(self, *, channel_id: str, thread_ts: str, reply) -> None:
        watcher = threading.Thread(
            target=self._watch_completion,
            kwargs={
                "channel_id": channel_id,
                "thread_ts": thread_ts,
                "reply": reply,
            },
            daemon=True,
        )
        watcher.start()
```

- [ ] **Step 4: Run the completion-reporting tests to verify they pass**

Run: `uv run pytest tests/test_slack_app.py -q`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit completion reporting**

```bash
git add src/slack_codex_router/codex_runner.py src/slack_codex_router/job_manager.py src/slack_codex_router/slack_app.py src/slack_codex_router/store.py tests/test_slack_app.py
git commit -m "feat: add completion reporting"
```

## Task 7: Wire Slack Message Routing for New Threads and Follow-Ups

**Files:**
- Modify: `src/slack_codex_router/slack_app.py`
- Modify: `src/slack_codex_router/main.py`
- Modify: `tests/test_slack_app.py`

- [ ] **Step 1: Extend the Slack routing test to cover top-level starts, follow-ups, and limit errors**

```python
# tests/test_slack_app.py
from pathlib import Path

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectConfig, ProjectRegistry
from slack_codex_router.slack_app import SlackRouter
from slack_codex_router.store import RouterStore


class FakeRunner:
    def start(self, project_path: Path, prompt: str):
        output_file = project_path / ".codex-last.txt"
        output_file.write_text("Final summary from Codex", encoding="utf-8")
        return type("Run", (), {"thread_id": "session-1", "pid": 1001, "process": None, "output_file": output_file})()

    def resume(self, project_path: Path, session_id: str, prompt: str):
        output_file = project_path / ".codex-last.txt"
        output_file.write_text("Updated final summary from Codex", encoding="utf-8")
        return type("Run", (), {"thread_id": session_id, "pid": 1002, "process": None, "output_file": output_file})()

    def interrupt(self, run) -> None:
        return None

    def wait(self, run) -> tuple[int, str]:
        return (0, run.output_file.read_text(encoding="utf-8"))


def test_top_level_message_starts_new_thread_and_follow_up_resumes(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    registry = ProjectRegistry(
        {
            "C123": ProjectConfig(
                channel_id="C123",
                name="demo",
                path=tmp_path,
                max_concurrent_jobs=2,
            )
        }
    )
    manager = JobManager(store=store, runner=FakeRunner(), global_limit=4, run_timeout_seconds=1800)
    router = SlackRouter(allowed_user_id="U123", registry=registry, manager=manager, store=store)
    replies: list[str] = []

    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000000.100000",
            "text": "inspect this repo",
        },
        replies.append,
    )
    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "thread_ts": "1710000000.100000",
            "ts": "1710000001.100000",
            "text": "only touch docs",
        },
        replies.append,
    )

    session = store.get_thread_session("1710000000.100000")
    assert session["codex_thread_id"] == "session-1"
    assert replies == [
        "Started Codex task for project `demo`.",
        "Interrupted prior run and resumed the Codex session with the latest message.",
    ]
```

- [ ] **Step 2: Run the Slack routing tests to verify they fail**

Run: `uv run pytest tests/test_slack_app.py -q`
Expected: FAIL until `SlackRouter.handle_message` and `main()` are wired to the manager and registry

- [ ] **Step 3: Implement Slack routing and app assembly**

```python
# src/slack_codex_router/slack_app.py
from __future__ import annotations

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

from slack_codex_router.commands import RouterCommands


class SlackRouter:
    def __init__(self, *, allowed_user_id: str, registry, manager, store) -> None:
        self._allowed_user_id = allowed_user_id
        self._registry = registry
        self._manager = manager
        self._store = store
        self._commands = RouterCommands(store=store, manager=manager)

    def handle_message(self, event: dict[str, str], reply) -> None:
        if event.get("user") != self._allowed_user_id:
            reply("User is not allowed to control this router.")
            return

        channel_id = event["channel"]
        project = self._registry.by_channel(channel_id)
        if project is None:
            reply("This channel is not registered to a project.")
            return

        thread_ts = event.get("thread_ts") or event["ts"]
        prompt = event.get("text", "").strip()
        if not prompt:
            reply("Send a non-empty message to start or continue a task.")
            return

        if event.get("thread_ts"):
            self._manager.handle_follow_up(
                channel_id=channel_id,
                thread_ts=thread_ts,
                user_message_ts=event["ts"],
                prompt=prompt,
                project=project,
            )
            self.start_completion_watch(channel_id=channel_id, thread_ts=thread_ts, reply=reply)
            reply("Interrupted prior run and resumed the Codex session with the latest message.")
            return

        self._manager.start_new_thread(
            channel_id=channel_id,
            thread_ts=thread_ts,
            user_message_ts=event["ts"],
            prompt=prompt,
            project=project,
        )
        reply(f"Started Codex task for project `{project.name}`.")


def build_app(*, bot_token: str, app_token: str, router: SlackRouter) -> SocketModeHandler:
    app = App(token=bot_token)

    @app.event("message")
    def on_message(event, say) -> None:
        router.handle_message(event, lambda text: say(text=text, thread_ts=event.get("thread_ts") or event["ts"]))

    return SocketModeHandler(app, app_token)
```

```python
# src/slack_codex_router/main.py
from __future__ import annotations

import argparse

from slack_codex_router.codex_runner import CodexRunner
from slack_codex_router.config import load_config
from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectRegistry
from slack_codex_router.slack_app import SlackRouter, build_app
from slack_codex_router.store import RouterStore


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="slack-codex-router")
    subcommands = parser.add_subparsers(dest="command")
    run_parser = subcommands.add_parser("run")
    run_parser.set_defaults(command="run")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command != "run":
        return 1

    config = load_config()
    registry = ProjectRegistry.from_yaml(config.projects_file)
    store = RouterStore(config.state_db)
    manager = JobManager(
        store=store,
        runner=CodexRunner(),
        global_limit=config.global_concurrency,
        run_timeout_seconds=config.run_timeout_seconds,
    )
    router = SlackRouter(
        allowed_user_id=config.allowed_user_id,
        registry=registry,
        manager=manager,
        store=store,
    )
    handler = build_app(
        bot_token=config.slack_bot_token,
        app_token=config.slack_app_token,
        router=router,
    )
    handler.start()
    return 0
```

- [ ] **Step 4: Run the Slack routing tests to verify they pass**

Run: `uv run pytest tests/test_slack_app.py -q`
Expected: PASS with `2 passed`

- [ ] **Step 5: Commit Slack routing**

```bash
git add src/slack_codex_router/slack_app.py src/slack_codex_router/main.py tests/test_slack_app.py
git commit -m "feat: wire slack message routing"
```

## Task 8: Add Thread-Aware Control Commands

**Files:**
- Create: `src/slack_codex_router/commands.py`
- Create: `tests/test_commands.py`
- Modify: `src/slack_codex_router/slack_app.py`
- Modify: `src/slack_codex_router/job_manager.py`
- Modify: `src/slack_codex_router/store.py`

- [ ] **Step 1: Write failing tests for `status`, `cancel`, `show diff`, and `what changed`**

```python
# tests/test_commands.py
from pathlib import Path

from slack_codex_router.commands import RouterCommands
from slack_codex_router.store import RouterStore


def test_what_changed_returns_latest_summary(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    job_id = store.start_job(thread_ts="1710000000.100000", pid=4242, log_path=str(tmp_path / "job.log"))
    store.finish_job(job_id=job_id, exit_code=0, interrupted=False, summary="Updated README.md and app.py")

    commands = RouterCommands(store=store)

    assert commands.what_changed("1710000000.100000") == "Updated README.md and app.py"
```

- [ ] **Step 2: Run the command tests to verify they fail**

Run: `uv run pytest tests/test_commands.py -q`
Expected: FAIL with `ModuleNotFoundError` for `slack_codex_router.commands`

- [ ] **Step 3: Implement command handling and route commands before Codex execution**

```python
# src/slack_codex_router/commands.py
from __future__ import annotations

import subprocess
from pathlib import Path


class RouterCommands:
    def __init__(self, *, store, manager=None) -> None:
        self._store = store
        self._manager = manager

    def status(self, thread_ts: str) -> str:
        session = self._store.get_thread_session(thread_ts)
        if session is None:
            return "No task has been started in this thread yet."
        return f"Thread status: {session['status']}"

    def cancel(self, thread_ts: str) -> str:
        if self._manager is None:
            return "Cancel is not configured."
        interrupted = self._manager.cancel_thread(thread_ts)
        return "Cancelled the active run." if interrupted else "There is no active run to cancel."

    def what_changed(self, thread_ts: str) -> str:
        job = self._store.get_latest_job(thread_ts)
        if job is None or not job["last_result_summary"]:
            return "No completed result is available for this thread yet."
        return str(job["last_result_summary"])

    def show_diff(self, project_path: Path) -> str:
        result = subprocess.run(
            ["git", "-C", str(project_path), "diff", "--stat", "--no-ext-diff"],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.stdout.strip() or "No git diff is available for this project."
```

```python
# src/slack_codex_router/job_manager.py
def cancel_thread(self, thread_ts: str) -> bool:
    current = self._active_by_thread.pop(thread_ts, None)
    if current is None:
        return False
    self._runner.interrupt(current.run)
    self._store.mark_thread_status(thread_ts, "cancelled", self._store.get_thread_session(thread_ts)["last_user_message_ts"])
    return True
```

```python
# src/slack_codex_router/slack_app.py
from __future__ import annotations

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

from slack_codex_router.commands import RouterCommands


class SlackRouter:
    def __init__(self, *, allowed_user_id: str, registry, manager, store) -> None:
        self._allowed_user_id = allowed_user_id
        self._registry = registry
        self._manager = manager
        self._store = store
        self._commands = RouterCommands(store=store, manager=manager)

    def handle_message(self, event: dict[str, str], reply) -> None:
        if event.get("user") != self._allowed_user_id:
            reply("User is not allowed to control this router.")
            return

        channel_id = event["channel"]
        project = self._registry.by_channel(channel_id)
        if project is None:
            reply("This channel is not registered to a project.")
            return

        thread_ts = event.get("thread_ts") or event["ts"]
        prompt = event.get("text", "").strip()
        if prompt == "status":
            reply(self._commands.status(thread_ts))
            return
        if prompt == "cancel":
            reply(self._commands.cancel(thread_ts))
            return
        if prompt == "what changed":
            reply(self._commands.what_changed(thread_ts))
            return
        if prompt == "show diff":
            reply(self._commands.show_diff(project.path))
            return

        if event.get("thread_ts"):
            self._manager.handle_follow_up(
                channel_id=channel_id,
                thread_ts=thread_ts,
                user_message_ts=event["ts"],
                prompt=prompt,
                project=project,
            )
            reply("Interrupted prior run and resumed the Codex session with the latest message.")
            return

        self._manager.start_new_thread(
            channel_id=channel_id,
            thread_ts=thread_ts,
            user_message_ts=event["ts"],
            prompt=prompt,
            project=project,
        )
        self.start_completion_watch(channel_id=channel_id, thread_ts=thread_ts, reply=reply)
        reply(f"Started Codex task for project `{project.name}`.")
```

- [ ] **Step 4: Run the command tests to verify they pass**

Run: `uv run pytest tests/test_commands.py -q`
Expected: PASS with `1 passed`

- [ ] **Step 5: Commit control commands**

```bash
git add src/slack_codex_router/commands.py src/slack_codex_router/slack_app.py src/slack_codex_router/job_manager.py tests/test_commands.py
git commit -m "feat: add thread-aware control commands"
```

## Task 9: Add an Integration Test for Thread Resume, Limits, and Interruption

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_integration_router.py`
- Modify: `src/slack_codex_router/store.py`
- Modify: `src/slack_codex_router/job_manager.py`

- [ ] **Step 1: Write the failing end-to-end integration test**

```python
# tests/test_integration_router.py
from pathlib import Path

from slack_codex_router.job_manager import JobManager
from slack_codex_router.registry import ProjectConfig, ProjectRegistry
from slack_codex_router.slack_app import SlackRouter
from slack_codex_router.store import RouterStore


class RecordingRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.interruptions: int = 0

    def start(self, project_path: Path, prompt: str):
        self.calls.append(("start", prompt))
        return type("Run", (), {"thread_id": "session-1", "pid": 1001, "process": None})()

    def resume(self, project_path: Path, session_id: str, prompt: str):
        self.calls.append(("resume", prompt))
        return type("Run", (), {"thread_id": session_id, "pid": 1002, "process": None})()

    def interrupt(self, run) -> None:
        self.interruptions += 1


def test_new_thread_then_follow_up_reuses_same_session(tmp_path: Path) -> None:
    store = RouterStore(tmp_path / "router.sqlite3")
    registry = ProjectRegistry(
        {
            "C123": ProjectConfig(
                channel_id="C123",
                name="demo",
                path=tmp_path,
                max_concurrent_jobs=2,
            )
        }
    )
    runner = RecordingRunner()
    manager = JobManager(store=store, runner=runner, global_limit=4, run_timeout_seconds=1800)
    router = SlackRouter(allowed_user_id="U123", registry=registry, manager=manager, store=store)
    replies: list[str] = []

    router.handle_message(
        {"user": "U123", "channel": "C123", "ts": "1710000000.100000", "text": "inspect repo"},
        replies.append,
    )
    router.handle_message(
        {
            "user": "U123",
            "channel": "C123",
            "ts": "1710000001.100000",
            "thread_ts": "1710000000.100000",
            "text": "only touch docs",
        },
        replies.append,
    )

    session = store.get_thread_session("1710000000.100000")

    assert runner.calls == [("start", "inspect repo"), ("resume", "only touch docs")]
    assert runner.interruptions == 1
    assert session["codex_thread_id"] == "session-1"
    assert replies[-1] == "Interrupted prior run and resumed the Codex session with the latest message."
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `uv run pytest tests/test_integration_router.py -q`
Expected: FAIL until the earlier router and manager pieces are fully connected

- [ ] **Step 3: Fill the missing integration gaps and finalize thread status updates**

```python
# src/slack_codex_router/store.py
def list_active_jobs(self) -> list[sqlite3.Row]:
    with self._connect() as connection:
        return connection.execute(
            "SELECT * FROM jobs WHERE state = 'running' ORDER BY job_id ASC"
        ).fetchall()
```

```python
# src/slack_codex_router/job_manager.py
def active_thread_count(self) -> int:
    return len(self._active_by_thread)


def complete_thread(self, thread_ts: str, *, exit_code: int, summary: str, interrupted: bool) -> None:
    latest_job = self._store.get_latest_job(thread_ts)
    if latest_job is None:
        raise RuntimeError(f"No job found for thread {thread_ts}")
    self._store.finish_job(
        job_id=int(latest_job["job_id"]),
        exit_code=exit_code,
        interrupted=interrupted,
        summary=summary,
    )
    self._store.mark_thread_status(thread_ts, "interrupted" if interrupted else "finished", self._store.get_thread_session(thread_ts)["last_user_message_ts"])
    self._active_by_thread.pop(thread_ts, None)
```

```python
# tests/conftest.py
import os


def pytest_configure() -> None:
    os.environ.setdefault("PYTHONUTF8", "1")
```

- [ ] **Step 4: Run the full test suite to verify the system hangs together**

Run: `uv run pytest -q`
Expected: PASS with all tests green

- [ ] **Step 5: Commit the integration coverage**

```bash
git add tests/conftest.py tests/test_integration_router.py src/slack_codex_router/store.py src/slack_codex_router/job_manager.py
git commit -m "test: cover thread resume and interruption flow"
```

## Task 10: Package the Service for Local Operation

**Files:**
- Create: `scripts/run-router.sh`
- Create: `ops/com.builtin.pb.slack-codex-router.plist`
- Modify: `README.md`

- [ ] **Step 1: Write the failing operational test as a README assertion checklist**

```markdown
# README acceptance checks

- `uv sync --dev` installs dependencies.
- `cp .env.example .env` gives the operator a complete environment template.
- `cp config/projects.example.yaml config/projects.yaml` gives the operator a complete channel registry template.
- `uv run python -m slack_codex_router.main run` is the foreground start command.
- `launchctl bootstrap gui/$(id -u) ops/com.builtin.pb.slack-codex-router.plist` is the background install command.
```

- [ ] **Step 2: Run the full test suite before packaging**

Run: `uv run pytest -q`
Expected: PASS with all tests green before writing operational docs

- [ ] **Step 3: Add the run script, launchd plist, and README**

```bash
# scripts/run-router.sh
#!/bin/zsh
set -euo pipefail

cd /Users/builtin.pb/Desktop/Template
export $(grep -v '^#' .env | xargs)
exec uv run python -m slack_codex_router.main run
```

```xml
<!-- ops/com.builtin.pb.slack-codex-router.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.builtin.pb.slack-codex-router</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/builtin.pb/Desktop/Template/scripts/run-router.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/builtin.pb/Desktop/Template</string>
    <key>StandardOutPath</key>
    <string>/Users/builtin.pb/Desktop/Template/logs/launchd.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/builtin.pb/Desktop/Template/logs/launchd.stderr.log</string>
  </dict>
</plist>
```

```markdown
# README.md
# Slack Codex Router

This repository hosts a Slack Socket Mode control plane that routes project-channel messages into local Codex sessions.

## Setup

1. Install dependencies:
   `uv sync --dev`
2. Copy environment defaults:
   `cp .env.example .env`
3. Copy the channel registry:
   `cp config/projects.example.yaml config/projects.yaml`
4. Edit `.env` and `config/projects.yaml` with real Slack tokens, the allowed Slack user id, and real channel-to-project mappings.

## Foreground Run

`uv run python -m slack_codex_router.main run`

## launchd

1. Make the run script executable:
   `chmod +x scripts/run-router.sh`
2. Bootstrap the agent:
   `launchctl bootstrap gui/$(id -u) ops/com.builtin.pb.slack-codex-router.plist`
3. Start it immediately:
   `launchctl kickstart -k gui/$(id -u)/com.builtin.pb.slack-codex-router`
```

- [ ] **Step 4: Verify docs and packaging**

Run: `chmod +x scripts/run-router.sh && uv run pytest -q`
Expected: `scripts/run-router.sh` is executable and the full test suite still passes

- [ ] **Step 5: Commit operational packaging**

```bash
git add scripts/run-router.sh ops/com.builtin.pb.slack-codex-router.plist README.md
git commit -m "docs: add local service packaging"
```
