#!/usr/bin/env python3
"""PointBench startup preflight checks.

The script is intentionally read-only: it reports environment problems and
SQLite schema conflicts before the backend tries to initialize or migrate data.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlparse


APP_TABLE_HINTS = {
    "projects",
    "test_points",
    "test_runs",
    "measurement_records",
    "media_files",
    "import_jobs",
}

REQUIRED_BACKEND_MODULES = [
    "fastapi",
    "uvicorn",
    "sqlalchemy",
    "alembic",
    "jose",
]

REQUIRED_FRONTEND_PACKAGES = [
    "vite",
    "@vitejs/plugin-react",
    "react",
    "react-dom",
]


@dataclass
class CheckResult:
    name: str
    status: str
    message: str


@dataclass
class Reporter:
    results: list[CheckResult] = field(default_factory=list)

    def ok(self, name: str, message: str) -> None:
        self.results.append(CheckResult(name, "OK", message))

    def warn(self, name: str, message: str) -> None:
        self.results.append(CheckResult(name, "WARN", message))

    def fail(self, name: str, message: str) -> None:
        self.results.append(CheckResult(name, "FAIL", message))

    def has_failures(self) -> bool:
        return any(item.status == "FAIL" for item in self.results)

    def render(self) -> str:
        lines = ["PointBench startup preflight report", ""]
        for item in self.results:
            lines.append(f"[{item.status}] {item.name}: {item.message}")
        lines.append("")
        if self.has_failures():
            lines.append("Result: FAILED. Fix the FAIL items before startup.")
        else:
            lines.append("Result: PASSED. WARN items should be reviewed but do not block startup.")
        return "\n".join(lines)


def run_command(command: list[str], cwd: Path | None = None) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=20,
            check=False,
        )
    except FileNotFoundError:
        return 127, f"command not found: {command[0]}"
    except subprocess.TimeoutExpired:
        return 124, "command timed out"
    return proc.returncode, proc.stdout.strip()


def sqlite_path_from_url(database_url: str, backend_dir: Path) -> Path | None:
    if not database_url.startswith("sqlite"):
        return None
    parsed = urlparse(database_url)
    if parsed.path in {"", "/"} and parsed.netloc in {"", ":memory:"}:
        return None
    if parsed.netloc and parsed.netloc != "":
        raw_path = f"//{parsed.netloc}{parsed.path}"
    else:
        raw_path = parsed.path
    raw_path = unquote(raw_path)
    if raw_path.startswith("/") and not re.match(r"^/[A-Za-z]:/", raw_path):
        return Path(raw_path).resolve()
    if raw_path.startswith("/") and re.match(r"^/[A-Za-z]:/", raw_path):
        raw_path = raw_path[1:]
    return (backend_dir / raw_path).resolve()


def read_alembic_heads(versions_dir: Path) -> tuple[set[str], set[str]]:
    revisions: set[str] = set()
    down_revisions: set[str] = set()
    for path in versions_dir.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        revision_match = re.search(r"^revision:\s*str\s*=\s*['\"]([^'\"]+)['\"]", text, re.MULTILINE)
        if revision_match:
            revisions.add(revision_match.group(1))
        down_match = re.search(r"^down_revision:.*?=\s*([^#\n]+)", text, re.MULTILINE)
        if not down_match:
            continue
        raw_value = down_match.group(1)
        for value in re.findall(r"['\"]([^'\"]+)['\"]", raw_value):
            down_revisions.add(value)
    return revisions, revisions - down_revisions


def sqlite_tables(db_path: Path) -> set[str]:
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
        rows = conn.execute("select name from sqlite_master where type='table'").fetchall()
    return {row[0] for row in rows}


def sqlite_columns(db_path: Path, table_name: str) -> set[str]:
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
        rows = conn.execute(f'pragma table_info("{table_name}")').fetchall()
    return {row[1] for row in rows}


def sqlite_alembic_version(db_path: Path) -> str | None:
    tables = sqlite_tables(db_path)
    if "alembic_version" not in tables:
        return None
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
        row = conn.execute("select version_num from alembic_version limit 1").fetchone()
    return str(row[0]) if row else None


def looks_like_app_db(db_path: Path) -> bool:
    try:
        return bool(sqlite_tables(db_path) & APP_TABLE_HINTS)
    except sqlite3.Error:
        return False


def load_expected_schema(project_root: Path, python_exe: str) -> tuple[dict[str, set[str]], str | None]:
    backend_dir = project_root / "backend"
    schema_code = (
        "import json; "
        "import app.models; "
        "from app.database import Base, DATABASE_URL; "
        "print(json.dumps({"
        "'database_url': DATABASE_URL, "
        "'schema': {table.name: list(table.columns.keys()) for table in Base.metadata.sorted_tables}"
        "}, ensure_ascii=False))"
    )
    code, output = run_command([python_exe, "-c", schema_code], cwd=backend_dir)
    if code != 0:
        raise RuntimeError(output or "backend schema introspection failed")
    payload = json.loads(output)
    expected = {name: set(columns) for name, columns in payload["schema"].items()}
    return expected, payload["database_url"]


def check_python(reporter: Reporter, python_exe: str, backend_dir: Path) -> None:
    code, output = run_command([python_exe, "--version"])
    if code == 0:
        reporter.ok("Python", output)
    else:
        reporter.fail("Python", output)
        return

    import_code = (
        "import importlib.util; "
        f"mods={REQUIRED_BACKEND_MODULES!r}; "
        "missing=[m for m in mods if importlib.util.find_spec(m) is None]; "
        "print('missing=' + ','.join(missing) if missing else 'all backend modules available'); "
        "raise SystemExit(1 if missing else 0)"
    )
    code, output = run_command([python_exe, "-c", import_code], cwd=backend_dir)
    if code == 0:
        reporter.ok("Backend dependencies", output)
    else:
        reporter.fail("Backend dependencies", output or "required Python packages are missing")


def check_node(reporter: Reporter, frontend_dir: Path) -> None:
    code, output = run_command(["node", "--version"], cwd=frontend_dir)
    if code == 0:
        reporter.ok("Node.js", output)
    else:
        reporter.fail("Node.js", output)

    code, output = run_command(["npm", "--version"], cwd=frontend_dir)
    if code == 0:
        reporter.ok("npm", output)
    else:
        reporter.fail("npm", output)

    package_json = frontend_dir / "package.json"
    node_modules = frontend_dir / "node_modules"
    if not package_json.exists():
        reporter.fail("Frontend project", f"missing {package_json}")
        return
    if not node_modules.exists():
        reporter.fail("Frontend dependencies", "missing frontend/node_modules; run npm install")
        return

    missing_packages = [
        package for package in REQUIRED_FRONTEND_PACKAGES if not (node_modules / package).exists()
    ]
    if missing_packages:
        reporter.fail("Frontend dependencies", "missing packages: " + ", ".join(missing_packages))
    else:
        reporter.ok("Frontend dependencies", "required packages are present in node_modules")

    vite_entry = node_modules / "vite" / "bin" / "vite.js"
    if vite_entry.exists():
        reporter.ok("Vite entry", str(vite_entry))
    else:
        reporter.fail("Vite entry", f"missing {vite_entry}")


def check_ports(reporter: Reporter) -> None:
    for port, label in [(8000, "Backend port"), (5173, "Frontend port")]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            in_use = sock.connect_ex(("127.0.0.1", port)) == 0
        if in_use:
            reporter.warn(label, f"127.0.0.1:{port} is already accepting connections")
        else:
            reporter.ok(label, f"127.0.0.1:{port} is available")


def check_storage(reporter: Reporter, backend_dir: Path) -> None:
    storage_dir = backend_dir / "storage"
    try:
        storage_dir.mkdir(parents=True, exist_ok=True)
        probe = storage_dir / ".preflight-write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        reporter.ok("Storage directory", f"writable: {storage_dir}")
    except OSError as exc:
        reporter.fail("Storage directory", f"not writable: {storage_dir} ({exc})")


def check_database(reporter: Reporter, project_root: Path, python_exe: str) -> None:
    backend_dir = project_root / "backend"
    try:
        expected_schema, database_url = load_expected_schema(project_root, python_exe)
    except Exception as exc:
        reporter.fail("Database configuration", f"cannot import backend schema: {exc}")
        return

    db_path = sqlite_path_from_url(database_url, backend_dir)
    if db_path is None:
        reporter.ok("Database URL", f"non-file database or in-memory database: {database_url}")
        return

    reporter.ok("Database URL", f"{database_url} -> {db_path}")
    revisions, heads = read_alembic_heads(backend_dir / "alembic" / "versions")
    if len(heads) == 1:
        head = next(iter(heads))
        reporter.ok("Alembic head", head)
    elif heads:
        head = None
        reporter.fail("Alembic head", "multiple heads detected: " + ", ".join(sorted(heads)))
    else:
        head = None
        reporter.fail("Alembic head", "no Alembic revisions found")

    candidates = {
        db_path,
        backend_dir / "test_point.db",
        backend_dir / "pointbench.db",
        project_root / "test_point.db",
        project_root / "pointbench.db",
        project_root / "data" / "pointbench.db",
    }
    existing_app_dbs = [path.resolve() for path in candidates if path.exists() and looks_like_app_db(path)]
    other_app_dbs = [path for path in existing_app_dbs if path != db_path]
    if other_app_dbs:
        reporter.warn(
            "SQLite database candidates",
            "other PointBench-like database files found: " + ", ".join(str(path) for path in other_app_dbs),
        )

    if not db_path.exists():
        reporter.ok("Active SQLite database", f"will be created on first startup: {db_path}")
        return

    try:
        tables = sqlite_tables(db_path)
    except sqlite3.Error as exc:
        reporter.fail("Active SQLite database", f"cannot read {db_path}: {exc}")
        return

    if not tables:
        reporter.ok("Active SQLite database", f"empty SQLite file: {db_path}")
        return

    app_tables = tables & set(expected_schema.keys())
    if not app_tables:
        reporter.warn("Active SQLite database", f"no PointBench tables found in {db_path}")
        return

    version = sqlite_alembic_version(db_path)
    if version is None:
        reporter.warn(
            "Database migration state",
            "existing PointBench tables have no alembic_version; checking schema compatibility as a legacy database",
        )
    elif version not in revisions:
        reporter.fail("Database migration state", f"unknown Alembic revision in database: {version}")
    elif head and version != head:
        reporter.warn(
            "Database migration state",
            f"database revision {version} is not current head {head}; startup migration will upgrade it",
        )
        return
    else:
        reporter.ok("Database migration state", f"current revision: {version}")

    missing_tables = sorted(set(expected_schema.keys()) - tables)
    if missing_tables:
        reporter.fail("Database schema", "missing tables: " + ", ".join(missing_tables))
        return

    missing_columns: list[str] = []
    for table_name, expected_columns in expected_schema.items():
        actual_columns = sqlite_columns(db_path, table_name)
        missing = sorted(expected_columns - actual_columns)
        if missing:
            missing_columns.append(f"{table_name}({', '.join(missing)})")
    if missing_columns:
        reporter.fail("Database schema", "missing columns: " + "; ".join(missing_columns))
    else:
        reporter.ok("Database schema", "active SQLite schema contains all expected tables and columns")


def check_project_files(reporter: Reporter, project_root: Path) -> None:
    required_files = [
        project_root / "backend" / "requirements.txt",
        project_root / "backend" / "alembic.ini",
        project_root / "frontend" / "package.json",
        project_root / "frontend" / "package-lock.json",
    ]
    missing = [str(path) for path in required_files if not path.exists()]
    if missing:
        reporter.fail("Project files", "missing: " + ", ".join(missing))
    else:
        reporter.ok("Project files", "required backend/frontend manifest files exist")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run PointBench startup preflight checks.")
    parser.add_argument("--project-root", default=Path(__file__).resolve().parents[1])
    parser.add_argument("--python", default=None, help="Python executable used by the backend")
    parser.add_argument("--report", default=None, help="Optional path to write the full report")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    backend_dir = project_root / "backend"
    frontend_dir = project_root / "frontend"
    python_exe = args.python or os.environ.get("PYTHON") or str(backend_dir / ".venv" / "bin" / "python")
    if not Path(python_exe).exists() and shutil.which(python_exe) is None:
        python_exe = "python3"

    reporter = Reporter()
    reporter.ok("Project root", str(project_root))
    check_project_files(reporter, project_root)
    check_python(reporter, python_exe, backend_dir)
    check_node(reporter, frontend_dir)
    check_ports(reporter)
    check_storage(reporter, backend_dir)
    check_database(reporter, project_root, python_exe)

    report = reporter.render()
    print(report)
    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(report + "\n", encoding="utf-8")
    return 1 if reporter.has_failures() else 0


if __name__ == "__main__":
    raise SystemExit(main())
