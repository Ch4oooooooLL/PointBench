import importlib.util
import sqlite3
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "preflight_check.py"
SPEC = importlib.util.spec_from_file_location("preflight_check", SCRIPT_PATH)
assert SPEC is not None
preflight_check = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = preflight_check
SPEC.loader.exec_module(preflight_check)


def _project_root(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    (root / "backend" / "alembic" / "versions").mkdir(parents=True)
    return root


def _sqlite_db(path: Path, statements: list[str]) -> None:
    with sqlite3.connect(path) as conn:
        for statement in statements:
            conn.execute(statement)
        conn.commit()


def test_preflight_allows_known_old_revision_before_startup_migration(tmp_path, monkeypatch) -> None:
    root = _project_root(tmp_path)
    db_path = root / "backend" / "test_point.db"
    _sqlite_db(
        db_path,
        [
            "create table projects (id integer primary key)",
            "create table alembic_version (version_num varchar(32) not null)",
            "insert into alembic_version (version_num) values ('oldrev')",
        ],
    )

    monkeypatch.setattr(
        preflight_check,
        "load_expected_schema",
        lambda project_root, python_exe: ({"projects": {"id", "project_name"}}, f"sqlite:///{db_path}"),
    )
    monkeypatch.setattr(
        preflight_check,
        "read_alembic_heads",
        lambda versions_dir: ({"oldrev", "headrev"}, {"headrev"}),
    )

    reporter = preflight_check.Reporter()
    preflight_check.check_database(reporter, root, "python")

    assert not reporter.has_failures()
    assert any(item.status == "WARN" and "startup migration will upgrade it" in item.message for item in reporter.results)


def test_preflight_allows_legacy_database_when_schema_is_compatible(tmp_path, monkeypatch) -> None:
    root = _project_root(tmp_path)
    db_path = root / "backend" / "test_point.db"
    _sqlite_db(db_path, ["create table projects (id integer primary key, project_name text)"])

    monkeypatch.setattr(
        preflight_check,
        "load_expected_schema",
        lambda project_root, python_exe: ({"projects": {"id", "project_name"}}, f"sqlite:///{db_path}"),
    )
    monkeypatch.setattr(
        preflight_check,
        "read_alembic_heads",
        lambda versions_dir: ({"headrev"}, {"headrev"}),
    )

    reporter = preflight_check.Reporter()
    preflight_check.check_database(reporter, root, "python")

    assert not reporter.has_failures()
    assert any(item.status == "WARN" and "no alembic_version" in item.message for item in reporter.results)
    assert any(item.status == "OK" and item.name == "Database schema" for item in reporter.results)


def test_preflight_fails_legacy_database_when_columns_are_missing(tmp_path, monkeypatch) -> None:
    root = _project_root(tmp_path)
    db_path = root / "backend" / "test_point.db"
    _sqlite_db(db_path, ["create table projects (id integer primary key)"])

    monkeypatch.setattr(
        preflight_check,
        "load_expected_schema",
        lambda project_root, python_exe: ({"projects": {"id", "project_name"}}, f"sqlite:///{db_path}"),
    )
    monkeypatch.setattr(
        preflight_check,
        "read_alembic_heads",
        lambda versions_dir: ({"headrev"}, {"headrev"}),
    )

    reporter = preflight_check.Reporter()
    preflight_check.check_database(reporter, root, "python")

    assert reporter.has_failures()
    assert any(item.status == "FAIL" and item.name == "Database schema" for item in reporter.results)


def test_preflight_does_not_require_npm_when_runtime_assets_exist(tmp_path, monkeypatch) -> None:
    frontend_dir = tmp_path / "frontend"
    (frontend_dir / "node_modules" / "vite" / "bin").mkdir(parents=True)
    for package in ["@vitejs/plugin-react", "react", "react-dom"]:
        (frontend_dir / "node_modules" / package).mkdir(parents=True)
    (frontend_dir / "package.json").write_text("{}", encoding="utf-8")
    (frontend_dir / "node_modules" / "vite" / "bin" / "vite.js").write_text("", encoding="utf-8")

    def fake_run_command(command, cwd=None):
        if command == ["node", "--version"]:
            return 0, "v24.16.0"
        if command == ["npm", "--version"]:
            return 127, "command not found: npm"
        return 1, "unexpected command"

    monkeypatch.setattr(preflight_check, "run_command", fake_run_command)

    reporter = preflight_check.Reporter()
    preflight_check.check_node(reporter, frontend_dir)

    assert not reporter.has_failures()
    assert any(item.status == "WARN" and item.name == "npm" for item in reporter.results)
    assert any(item.status == "OK" and item.name == "Vite entry" for item in reporter.results)
