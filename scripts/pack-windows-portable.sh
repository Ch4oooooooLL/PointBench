#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR=""
OUTPUT_NAME="PointBench-portable"
FRONTEND_MODE="auto"
DRY_RUN=0
KEEP_BUILD=0
SKIP_PYTHON_DEPS_CHECK=0
BUILD_DIR=""

usage() {
  cat <<'USAGE'
Usage: scripts/pack-windows-portable.sh [options]

Create a Windows portable PointBench zip from Linux.

Options:
  --project-dir DIR          Project root. Defaults to this repository root.
  --output-dir DIR           Output directory. Defaults to project root.
  --output-name NAME         Zip name prefix. Defaults to PointBench-portable.
  --frontend auto            Use current node_modules if Windows deps exist, otherwise prepare them. Default.
  --frontend current         Package current frontend/node_modules and fail if Windows deps are missing.
  --frontend prepare         Always prepare Windows node_modules in a temporary build directory.
  --skip-python-deps-check   Skip runtime/python/Lib/site-packages dependency presence checks.
  --dry-run                  Run checks and print what would be packaged without creating a zip.
  --keep-build               Keep the temporary frontend build directory.
  -h, --help                 Show this help.

The script never creates an installer. The resulting zip contains unpacked
runtime/python, runtime/node, and frontend/node_modules for Windows.
USAGE
}

fail() {
  printf '\n[ERROR] %s\n\n' "$*" >&2
  exit 1
}

info() {
  printf '[INFO] %s\n' "$*"
}

cleanup() {
  if [[ "$KEEP_BUILD" -eq 0 && -n "$BUILD_DIR" && -d "$BUILD_DIR" ]]; then
    rm -rf "$BUILD_DIR"
  fi
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir)
      [[ $# -ge 2 ]] || fail "--project-dir requires a value"
      PROJECT_DIR="$2"
      shift 2
      ;;
    --output-dir)
      [[ $# -ge 2 ]] || fail "--output-dir requires a value"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --output-name)
      [[ $# -ge 2 ]] || fail "--output-name requires a value"
      OUTPUT_NAME="$2"
      shift 2
      ;;
    --frontend)
      [[ $# -ge 2 ]] || fail "--frontend requires auto, current, or prepare"
      FRONTEND_MODE="$2"
      shift 2
      ;;
    --skip-python-deps-check)
      SKIP_PYTHON_DEPS_CHECK=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --keep-build)
      KEEP_BUILD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

case "$FRONTEND_MODE" in
  auto|current|prepare) ;;
  *) fail "--frontend must be auto, current, or prepare" ;;
esac

PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$PROJECT_DIR"
fi
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

require_file() {
  local path="$1"
  [[ -f "$PROJECT_DIR/$path" ]] || fail "Missing required file: $path"
}

require_dir() {
  local path="$1"
  [[ -d "$PROJECT_DIR/$path" ]] || fail "Missing required directory: $path"
}

command -v python3 >/dev/null 2>&1 || fail "python3 is required"

require_file "runtime/python/python.exe"
require_file "runtime/node/node.exe"
require_dir "runtime/python/Lib/site-packages"
require_dir "runtime/node"
require_file "frontend/package.json"
require_file "frontend/package-lock.json"
require_file "frontend/node_modules/vite/bin/vite.js"
require_file "start.bat"
require_file "run.bat"
require_file "run.vbs"
require_file "scripts/launcher.ps1"
require_file "scripts/preflight_check.py"
require_file "scripts/pack-portable.bat"
require_file "scripts/pack-portable.ps1"
require_file "scripts/pack-windows-portable.sh"
require_file "backend/alembic.ini"
require_file "backend/app/main.py"
require_file "backend/app/database.py"
require_file "backend/app/models.py"

if [[ "$SKIP_PYTHON_DEPS_CHECK" -eq 0 ]]; then
  python3 - "$PROJECT_DIR/runtime/python/Lib/site-packages" <<'PY'
import sys
from pathlib import Path

site = Path(sys.argv[1])
modules = ["fastapi", "uvicorn", "sqlalchemy", "alembic", "jose", "pandas", "numpy", "openpyxl"]
missing = []
for module in modules:
    if not (site / module).exists() and not list(site.glob(module.replace("-", "_") + "-*.dist-info")):
        missing.append(module)
if missing:
    print("[ERROR] Portable Python runtime is missing dependencies:", ", ".join(missing), file=sys.stderr)
    print("        Build or copy a complete runtime/python before packaging.", file=sys.stderr)
    raise SystemExit(1)
print("[OK] Portable Python dependency directories found")
PY
else
  info "Skipping portable Python dependency directory checks."
fi

windows_frontend_deps_ok() {
  [[ -d "$1/@esbuild/win32-x64" && -d "$1/@rollup/rollup-win32-x64-msvc" ]]
}

FRONTEND_NODE_MODULES="$PROJECT_DIR/frontend/node_modules"
if [[ "$FRONTEND_MODE" == "prepare" ]] || { [[ "$FRONTEND_MODE" == "auto" ]] && ! windows_frontend_deps_ok "$FRONTEND_NODE_MODULES"; }; then
  command -v npm >/dev/null 2>&1 || fail "npm is required to prepare Windows frontend dependencies"
  BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pointbench-winpack.XXXXXX")"
  FRONTEND_BUILD="$BUILD_DIR/frontend"
  mkdir -p "$FRONTEND_BUILD"
  cp "$PROJECT_DIR/frontend/package.json" "$FRONTEND_BUILD/package.json"
  cp "$PROJECT_DIR/frontend/package-lock.json" "$FRONTEND_BUILD/package-lock.json"
  info "Preparing Windows frontend node_modules in $FRONTEND_BUILD"
  (
    cd "$FRONTEND_BUILD"
    npm ci --os=win32 --cpu=x64 --include=optional
  )
  FRONTEND_NODE_MODULES="$FRONTEND_BUILD/node_modules"
fi

windows_frontend_deps_ok "$FRONTEND_NODE_MODULES" || fail "frontend/node_modules does not contain Windows native dependencies (@esbuild/win32-x64 and @rollup/rollup-win32-x64-msvc)"
[[ -f "$FRONTEND_NODE_MODULES/vite/bin/vite.js" ]] || fail "selected frontend node_modules is missing vite/bin/vite.js"

if [[ "$DRY_RUN" -eq 1 ]]; then
  info "Dry run passed."
  info "Project root: $PROJECT_DIR"
  info "Output dir:   $OUTPUT_DIR"
  info "Frontend deps: $FRONTEND_NODE_MODULES"
  exit 0
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT="$OUTPUT_DIR/${OUTPUT_NAME}-${TIMESTAMP}.zip"
export POINTBENCH_PACK_PROJECT_DIR="$PROJECT_DIR"
export POINTBENCH_PACK_OUTPUT="$OUTPUT"
export POINTBENCH_PACK_FRONTEND_NODE_MODULES="$FRONTEND_NODE_MODULES"

python3 <<'PY'
import os
import re
import sys
import zipfile
from pathlib import Path

root = Path(os.environ["POINTBENCH_PACK_PROJECT_DIR"]).resolve()
output = Path(os.environ["POINTBENCH_PACK_OUTPUT"]).resolve()
frontend_node_modules = Path(os.environ["POINTBENCH_PACK_FRONTEND_NODE_MODULES"]).resolve()

include_items = [
    "start.bat",
    "run.bat",
    "run.vbs",
    "backend",
    "frontend",
    "runtime",
    "scripts",
    "doc",
    "sample_data",
]

required_entries = {
    "start.bat",
    "run.bat",
    "run.vbs",
    "scripts/launcher.ps1",
    "scripts/preflight_check.py",
    "scripts/pack-portable.bat",
    "scripts/pack-portable.ps1",
    "scripts/pack-windows-portable.sh",
    "backend/app/main.py",
    "backend/app/database.py",
    "backend/alembic.ini",
    "frontend/package.json",
    "frontend/node_modules/vite/bin/vite.js",
    "frontend/node_modules/@esbuild/win32-x64/package.json",
    "frontend/node_modules/@rollup/rollup-win32-x64-msvc/package.json",
    "runtime/python/python.exe",
    "runtime/node/node.exe",
    "logs/",
    "backend/storage/",
}

forbidden_patterns = [
    re.compile(r"^\.git/"),
    re.compile(r"^backend/tests/"),
    re.compile(r"^backend/\.venv/"),
    re.compile(r"^backend/storage/.+"),
    re.compile(r"^frontend/dist/"),
    re.compile(r"^frontend/\.vite/"),
    re.compile(r"^runtime/get-pip\.py$"),
    re.compile(r"^runtime/install-deps\.bat$"),
    re.compile(r"^runtime/setup-env\.bat$"),
    re.compile(r"^runtime/pip-packages/"),
    re.compile(r"^offline-install/"),
    re.compile(r"^logs/.+"),
    re.compile(r"__pycache__/"),
    re.compile(r"\.pyc$"),
    re.compile(r"\.db$"),
    re.compile(r"^(PointBench-portable|test-point-web-portable)-.*\.zip$"),
]

def should_skip(relative: str) -> bool:
    rel = relative.replace("\\", "/")
    name = Path(rel).name
    skip_prefixes = [
        ".git/",
        "logs/",
        "outputs/",
        "storage/",
        "backend/storage/",
        "backend/.venv/",
        "backend/tests/",
        "frontend/dist/",
        "frontend/.vite/",
        "frontend/node_modules/",
        "runtime/pip-packages/",
        "runtime/node-temp/",
        "offline-install/",
        "installers/",
    ]
    if any(rel == prefix[:-1] or rel.startswith(prefix) for prefix in skip_prefixes):
        return True
    if rel in {"runtime/get-pip.py", "runtime/install-deps.bat", "runtime/setup-env.bat", "offline-install.zip"}:
        return True
    if re.match(r"^(PointBench-portable|test-point-web-portable)-.*\.zip$", rel):
        return True
    if "__pycache__/" in rel:
        return True
    if name.endswith((".pyc", ".pyo", ".db", ".db-journal", ".db-wal", ".tar.gz", ".tar.xz")):
        return True
    if name in {"python-embed.zip", "nodejs.zip", "tsconfig.tsbuildinfo"}:
        return True
    return False

def add_file(archive: zipfile.ZipFile, source: Path, entry: str) -> None:
    archive.write(source, entry.replace("\\", "/"))

files_added = 0
output.parent.mkdir(parents=True, exist_ok=True)
if output.exists():
    output.unlink()

with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for item in include_items:
        path = root / item
        if not path.exists():
            continue
        if path.is_file():
            if not should_skip(item):
                add_file(archive, path, item)
                files_added += 1
            continue
        for source in path.rglob("*"):
            if not source.is_file():
                continue
            relative = source.relative_to(root).as_posix()
            if should_skip(relative):
                continue
            add_file(archive, source, relative)
            files_added += 1

    for source in frontend_node_modules.rglob("*"):
        if not source.is_file():
            continue
        relative = source.relative_to(frontend_node_modules).as_posix()
        if "__pycache__/" in relative or relative.endswith((".pyc", ".pyo")):
            continue
        add_file(archive, source, f"frontend/node_modules/{relative}")
        files_added += 1

    for directory in [
        "logs/",
        "backend/storage/",
        "backend/storage/imports/",
        "backend/storage/projects/",
        "backend/storage/dewesoft/",
        "backend/storage/temp/",
        "backend/storage/delete_exports/",
    ]:
        archive.writestr(directory, "")

with zipfile.ZipFile(output) as archive:
    names = set(archive.namelist())
    missing = sorted(required_entries - names)
    if missing:
        print("[ERROR] zip verification failed. Missing entries:", file=sys.stderr)
        for item in missing:
            print(f"  - {item}", file=sys.stderr)
        raise SystemExit(1)
    forbidden = []
    for name in names:
        if name.endswith("/"):
            continue
        if any(pattern.search(name) for pattern in forbidden_patterns):
            forbidden.append(name)
    if forbidden:
        print("[ERROR] zip verification failed. Forbidden entries found:", file=sys.stderr)
        for item in sorted(forbidden)[:50]:
            print(f"  - {item}", file=sys.stderr)
        raise SystemExit(1)

size_mb = output.stat().st_size / 1024 / 1024
print(f"[OK] Created {output}")
print(f"[OK] Files: {files_added}")
print(f"[OK] Size: {size_mb:.1f} MB")
PY
