"""External datasets a target's eval adapter needs inside the job — today: BIRD Mini-Dev for DataPilot.

The 801 MB archive is downloaded once per cache (GitHub Actions caches the directory between runs), then only the
SQLite databases and the question file are extracted into the job's work directory. Members are checked so a
malicious archive cannot write outside the destination.
"""

from __future__ import annotations

import logging
import os
import shutil
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

BIRD_URL = "https://bird-bench.oss-cn-beijing.aliyuncs.com/minidev.zip"
BIRD_ZIP = "minidev.zip"
BIRD_PREFIX = "minidev/MINIDEV/"


def needs_bird(agent: str, cases: list[dict[str, Any]]) -> bool:
    """Same rule as DataPilot's eval adapter: BIRD source, a `bird` tag, or a dp-bird id."""
    if agent != "datapilot":
        return False
    for c in cases:
        inp = c.get("input") or {}
        if (
            inp.get("db_source") == "bird"
            or "bird" in (c.get("tags") or [])
            or str(c.get("case_id", "")).startswith("dp-bird")
        ):
            return True
    return False


def _download(url: str, dest: Path, attempts: int = 4) -> None:
    tmp = dest.with_suffix(".part")
    for i in range(1, attempts + 1):
        try:
            log.info("downloading %s (attempt %d)", url, i)
            with urllib.request.urlopen(url, timeout=120) as r, tmp.open("wb") as f:
                shutil.copyfileobj(r, f, length=1 << 20)
            tmp.replace(dest)
            return
        except OSError as exc:
            log.warning("download failed: %s", exc)
            time.sleep(10 * i)
    raise RuntimeError(f"could not download {url}")


def _safe_extract(zf: zipfile.ZipFile, member: zipfile.ZipInfo, root: Path) -> None:
    rel = member.filename[len(BIRD_PREFIX) :]
    target = (root / rel).resolve()
    if not str(target).startswith(str(root.resolve()) + os.sep):
        raise RuntimeError(f"refusing to extract {member.filename!r} outside {root}")
    if member.is_dir():
        target.mkdir(parents=True, exist_ok=True)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with zf.open(member) as src, target.open("wb") as dst:
        shutil.copyfileobj(src, dst, length=1 << 20)


def ensure_bird(cache_dir: Path, work_dir: Path, url: str | None = None) -> Path:
    """Return a directory holding `dev_databases/` and `mini_dev_sqlite.json` (DataPilot's BIRD_DIR)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / BIRD_ZIP
    if not archive.exists():
        _download(url or os.environ.get("BIRD_MINIDEV_URL") or BIRD_URL, archive)
    out = work_dir / "bird"
    if (out / "dev_databases").is_dir() and (out / "mini_dev_sqlite.json").is_file():
        return out
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as zf:
        wanted = [
            m
            for m in zf.infolist()
            if m.filename.startswith(BIRD_PREFIX + "dev_databases/")
            or m.filename == BIRD_PREFIX + "mini_dev_sqlite.json"
        ]
        if not wanted:
            raise RuntimeError("BIRD archive has no minidev/MINIDEV/dev_databases")
        for m in wanted:
            _safe_extract(zf, m, out)
    log.info("BIRD Mini-Dev extracted to %s", out)
    return out
