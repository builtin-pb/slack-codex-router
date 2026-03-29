from __future__ import annotations

import os


def pytest_configure() -> None:
    os.environ["PYTHONUTF8"] = "1"
