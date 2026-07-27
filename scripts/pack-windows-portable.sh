#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR=""
OUTPUT_NAME="PointBench"
PYTHON_VERSION="3.14.6"
NODE_VERSION="v24.16.0"
RUNTIME_MODE="auto"
FRONTEND_MODE="auto"
DRY_RUN=0
KEEP_BUILD=0
BUILD_DIR=""
HOST_PYTHON="python3"

usage() {
  cat <<'USAGE'
Usage: scripts/pack-windows-portable.sh [options]

Create split Windows portable PointBench artifacts from Linux.

By default, the script:
  1. Reuses existing runtime/ only when it is complete.
  2. Otherwise downloads Windows embeddable Python and portable Node.js.
  3. Downloads Windows Python wheels and unpacks them into runtime/python.
  4. Prepares Windows target frontend/node_modules when needed.
  5. Creates a code-only zip and an unpacked dependency directory.

Options:
  --project-dir DIR       Project root. Defaults to this repository root.
  --output-dir DIR        Output directory. Defaults to project root.
  --output-name NAME      Artifact name prefix. Defaults to PointBench.
  --python-version VER    Windows embeddable Python version. Defaults to 3.14.6.
  --node-version VER      Windows Node.js version. Defaults to v24.16.0.
  --runtime auto          Reuse complete project runtime, otherwise download. Default.
  --runtime refresh       Always download/build runtime in a temporary directory.
  --runtime current       Require existing project runtime to be complete.
  --frontend auto         Reuse current node_modules if Windows deps exist, otherwise prepare. Default.
  --frontend current      Require current frontend/node_modules to contain Windows deps.
  --frontend prepare      Always prepare Windows node_modules in a temporary directory.
  --dry-run               Validate inputs/tools and print planned actions without downloading or packaging.
  --keep-build            Keep temporary build directory for inspection.
  -h, --help              Show this help.
USAGE
}

fail() {
  printf '\n[ERROR] %s\n\n' "$*" >&2
  exit 1
}

info() {
  printf '[INFO] %s\n' "$*"
}

ok() {
  printf '[OK] %s\n' "$*"
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
    --python-version)
      [[ $# -ge 2 ]] || fail "--python-version requires a value"
      PYTHON_VERSION="$2"
      shift 2
      ;;
    --node-version)
      [[ $# -ge 2 ]] || fail "--node-version requires a value"
      NODE_VERSION="$2"
      shift 2
      ;;
    --runtime)
      [[ $# -ge 2 ]] || fail "--runtime requires auto, refresh, or current"
      RUNTIME_MODE="$2"
      shift 2
      ;;
    --frontend)
      [[ $# -ge 2 ]] || fail "--frontend requires auto, current, or prepare"
      FRONTEND_MODE="$2"
      shift 2
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

case "$RUNTIME_MODE" in
  auto|refresh|current) ;;
  *) fail "--runtime must be auto, refresh, or current" ;;
esac
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

ensure_build_dir() {
  if [[ -z "$BUILD_DIR" ]]; then
    BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pointbench-winpack.XXXXXX")"
  fi
}

ensure_host_pip() {
  if "$HOST_PYTHON" -m pip --version >/dev/null 2>&1; then
    return
  fi

  ensure_build_dir
  local venv_dir="$BUILD_DIR/host-python"
  info "Host python has no pip; creating temporary venv at $venv_dir"
  python3 -m venv "$venv_dir" || fail "Failed to create a temporary host Python venv. Install python3-venv or provide python3 with pip."
  HOST_PYTHON="$venv_dir/bin/python"
  "$HOST_PYTHON" -m pip --version >/dev/null 2>&1 || fail "Temporary host Python venv does not provide pip"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

require_file() {
  local path="$1"
  [[ -f "$PROJECT_DIR/$path" ]] || fail "Missing required file: $path"
}

require_dir() {
  local path="$1"
  [[ -d "$PROJECT_DIR/$path" ]] || fail "Missing required directory: $path"
}

download_file() {
  local url="$1"
  local output="$2"
  info "Downloading $url"
  curl --fail -L --retry 3 --retry-delay 2 --progress-bar -o "$output" "$url"
}

python_minor() {
  printf '%s\n' "$PYTHON_VERSION" | awk -F. '{ print $1 "." $2 }'
}

python_tag() {
  printf 'cp%s\n' "$(printf '%s\n' "$PYTHON_VERSION" | awk -F. '{ print $1 $2 }')"
}

python_site_deps_ok() {
  local site="$1"
  [[ -d "$site" ]] || return 1
  python3 - "$site" <<'PY' >/dev/null
import sys
from pathlib import Path

site = Path(sys.argv[1])
modules = ["fastapi", "uvicorn", "sqlalchemy", "alembic", "jose", "pandas", "numpy", "openpyxl"]
missing = []
for module in modules:
    if not (site / module).exists() and not list(site.glob(module.replace("-", "_") + "-*.dist-info")):
        missing.append(module)
raise SystemExit(1 if missing else 0)
PY
}

runtime_python_deps_ok() {
  local runtime_dir="$1"
  [[ -f "$runtime_dir/python/python.exe" && -f "$runtime_dir/node/node.exe" ]] || return 1
  python_site_deps_ok "$runtime_dir/python/Lib/site-packages"
}

configure_embeddable_python() {
  local python_dir="$1"
  local pth_file stdlib_zip
  pth_file="$(find "$python_dir" -maxdepth 1 -name 'python*._pth' | head -n 1)"
  [[ -n "$pth_file" && -f "$pth_file" ]] || fail "Could not find python*._pth in $python_dir"

  # Embeddable Python normally imports the standard library from python3xx.zip.
  # Expand it because deployed dependencies must not contain or use archives.
  stdlib_zip="$(find "$python_dir" -maxdepth 1 -name 'python*.zip' | head -n 1)"
  [[ -n "$stdlib_zip" && -f "$stdlib_zip" ]] || fail "Could not find the embeddable Python standard-library zip"
  mkdir -p "$python_dir/Lib"
  unzip -qo "$stdlib_zip" -d "$python_dir/Lib"
  rm -f "$stdlib_zip"

  python3 - "$pth_file" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines()
updated = []
seen_site = False
seen_lib_site = False
for line in lines:
    if line.strip().startswith("python") and line.strip().endswith(".zip"):
        line = "Lib"
    if line.strip() == "#import site":
        line = "import site"
    if line.strip() == "import site":
        seen_site = True
    if line.strip().replace("\\", "/") == "Lib/site-packages":
        seen_lib_site = True
    updated.append(line)
if not seen_lib_site:
    updated.append("Lib/site-packages")
if "Lib" not in updated:
    updated.append("Lib")
if not seen_site:
    updated.append("import site")
path.write_text("\n".join(updated) + "\n", encoding="utf-8")
PY
  mkdir -p "$python_dir/Lib/site-packages"
}

unpack_wheels_to_site_packages() {
  local wheels_dir="$1"
  local site_packages="$2"
  python3 - "$wheels_dir" "$site_packages" <<'PY'
import sys
import zipfile
from pathlib import Path

wheels = sorted(Path(sys.argv[1]).glob("*.whl"))
site = Path(sys.argv[2])
site.mkdir(parents=True, exist_ok=True)
if not wheels:
    print("[ERROR] no wheels were downloaded", file=sys.stderr)
    raise SystemExit(1)
for wheel in wheels:
    with zipfile.ZipFile(wheel) as archive:
        archive.extractall(site)
print(f"[OK] unpacked {len(wheels)} wheels into {site}")
PY
}

build_windows_runtime() {
  require_command curl
  require_command unzip
  require_command python3

  ensure_build_dir
  local runtime_dir="$BUILD_DIR/runtime"
  local downloads_dir="$BUILD_DIR/downloads"
  local wheels_dir="$BUILD_DIR/wheels"
  local python_dir="$runtime_dir/python"
  local node_dir="$runtime_dir/node"
  local windows_requirements="$BUILD_DIR/requirements-windows.txt"
  local py_minor py_tag_value

  rm -rf "$runtime_dir" "$downloads_dir" "$wheels_dir"
  mkdir -p "$downloads_dir" "$wheels_dir" "$python_dir" "$node_dir"

  local python_zip="$downloads_dir/python-embed.zip"
  local node_zip="$downloads_dir/node-win-x64.zip"
  local python_url="https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip"
  local node_url="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip"

  download_file "$python_url" "$python_zip"
  unzip -qo "$python_zip" -d "$python_dir"
  [[ -f "$python_dir/python.exe" ]] || fail "Downloaded Python archive did not contain python.exe"
  configure_embeddable_python "$python_dir"

  py_minor="$(python_minor)"
  py_tag_value="$(python_tag)"
  python3 - "$PROJECT_DIR/backend/requirements.txt" "$windows_requirements" <<'PY'
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
lines = []
for line in source.read_text(encoding="utf-8").splitlines():
    stripped = line.strip()
    if stripped.startswith("uvicorn[standard]"):
        line = line.replace("uvicorn[standard]", "uvicorn", 1)
    lines.append(line)
target.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
  info "Downloading Windows Python wheels for Python $py_minor ($py_tag_value)"
  ensure_host_pip
  "$HOST_PYTHON" -m pip download \
    --platform win_amd64 \
    --python-version "$py_minor" \
    --implementation cp \
    --abi "$py_tag_value" \
    --only-binary=:all: \
    -r "$windows_requirements" \
    -d "$wheels_dir" || fail "Failed to download Windows Python wheels"
  unpack_wheels_to_site_packages "$wheels_dir" "$python_dir/Lib/site-packages"
  python_site_deps_ok "$python_dir/Lib/site-packages" || fail "Downloaded Python runtime is still missing required modules"

  download_file "$node_url" "$node_zip"
  local node_extract="$BUILD_DIR/node-extract"
  rm -rf "$node_extract"
  mkdir -p "$node_extract"
  unzip -qo "$node_zip" -d "$node_extract"
  local node_inner
  node_inner="$(find "$node_extract" -mindepth 1 -maxdepth 1 -type d -name 'node-v*' | head -n 1)"
  [[ -n "$node_inner" ]] || fail "Downloaded Node.js archive did not contain node-v* directory"
  cp -a "$node_inner"/. "$node_dir"/
  [[ -f "$node_dir/node.exe" ]] || fail "Downloaded Node.js archive did not contain node.exe"
  runtime_python_deps_ok "$runtime_dir" || fail "Downloaded runtime is incomplete"

  ok "Built Windows runtime under $runtime_dir"
  RUNTIME_DIR_FOR_PACKAGE="$runtime_dir"
}

windows_frontend_deps_ok() {
  [[ -d "$1/@esbuild/win32-x64" && -d "$1/@rollup/rollup-win32-x64-msvc" ]]
}

prepare_windows_frontend_node_modules() {
  require_command npm
  ensure_build_dir
  local frontend_build="$BUILD_DIR/frontend"
  rm -rf "$frontend_build"
  mkdir -p "$frontend_build"
  cp "$PROJECT_DIR/frontend/package.json" "$frontend_build/package.json"
  cp "$PROJECT_DIR/frontend/package-lock.json" "$frontend_build/package-lock.json"
  info "Preparing Windows frontend node_modules in $frontend_build"
  (
    cd "$frontend_build"
    npm ci --os=win32 --cpu=x64 --include=optional
  )
  windows_frontend_deps_ok "$frontend_build/node_modules" || fail "Prepared frontend node_modules does not contain Windows native dependencies"
  FRONTEND_NODE_MODULES="$frontend_build/node_modules"
}

require_command python3
require_file "frontend/package.json"
require_file "frontend/package-lock.json"
require_file "start.bat"
require_file "run.bat"
require_file "run.vbs"
require_file "scripts/launcher.ps1"
require_file "scripts/preflight_check.py"
require_file "scripts/pack-portable.bat"
require_file "scripts/pack-portable.ps1"
require_file "scripts/pack-code.bat"
require_file "scripts/pack-code.ps1"
require_file "scripts/pack-dependencies.bat"
require_file "scripts/pack-dependencies.ps1"
require_file "scripts/setup-portable-deps.bat"
require_file "scripts/setup-portable-deps.ps1"
require_file "scripts/pack-windows-portable.sh"
require_file "backend/requirements.txt"
require_file "backend/alembic.ini"
require_file "backend/app/main.py"
require_file "backend/app/database.py"
require_file "backend/app/models.py"

PROJECT_RUNTIME_DIR="$PROJECT_DIR/runtime"
RUNTIME_DIR_FOR_PACKAGE="$PROJECT_RUNTIME_DIR"
RUNTIME_COMPLETE=0
if runtime_python_deps_ok "$PROJECT_RUNTIME_DIR"; then
  RUNTIME_COMPLETE=1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  info "Dry run."
  info "Project root: $PROJECT_DIR"
  info "Output dir:   $OUTPUT_DIR"
  info "Runtime mode: $RUNTIME_MODE"
  info "Frontend mode: $FRONTEND_MODE"
  if [[ "$RUNTIME_MODE" == "refresh" || ( "$RUNTIME_MODE" == "auto" && "$RUNTIME_COMPLETE" -eq 0 ) ]]; then
    info "Runtime action: would download Python $PYTHON_VERSION, Windows wheels, and Node.js $NODE_VERSION"
  elif [[ "$RUNTIME_COMPLETE" -eq 1 ]]; then
    info "Runtime action: would reuse existing project runtime"
  else
    fail "Runtime action: existing project runtime is incomplete"
  fi
  if [[ "$FRONTEND_MODE" == "prepare" ]] || { [[ "$FRONTEND_MODE" == "auto" ]] && ! windows_frontend_deps_ok "$PROJECT_DIR/frontend/node_modules"; }; then
    info "Frontend action: would run npm ci --os=win32 --cpu=x64 --include=optional"
  elif windows_frontend_deps_ok "$PROJECT_DIR/frontend/node_modules"; then
    info "Frontend action: would reuse existing frontend/node_modules"
  else
    fail "Frontend action: existing frontend/node_modules does not contain Windows native dependencies"
  fi
  exit 0
fi

case "$RUNTIME_MODE" in
  refresh)
    build_windows_runtime
    ;;
  auto)
    if [[ "$RUNTIME_COMPLETE" -eq 1 ]]; then
      info "Using existing complete project runtime."
    else
      info "Existing project runtime is missing or incomplete; downloading a fresh Windows runtime."
      build_windows_runtime
    fi
    ;;
  current)
    [[ "$RUNTIME_COMPLETE" -eq 1 ]] || fail "Existing project runtime is incomplete. Use --runtime auto or --runtime refresh to download dependencies."
    ;;
esac

FRONTEND_NODE_MODULES="$PROJECT_DIR/frontend/node_modules"
case "$FRONTEND_MODE" in
  prepare)
    prepare_windows_frontend_node_modules
    ;;
  auto)
    if windows_frontend_deps_ok "$FRONTEND_NODE_MODULES"; then
      info "Using existing frontend/node_modules with Windows native dependencies."
    else
      prepare_windows_frontend_node_modules
    fi
    ;;
  current)
    windows_frontend_deps_ok "$FRONTEND_NODE_MODULES" || fail "Current frontend/node_modules does not contain Windows native dependencies. Use --frontend auto or --frontend prepare."
    ;;
esac
[[ -f "$FRONTEND_NODE_MODULES/vite/bin/vite.js" ]] || fail "Selected frontend node_modules is missing vite/bin/vite.js"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT="$OUTPUT_DIR/${OUTPUT_NAME}-code-${TIMESTAMP}.zip"
export POINTBENCH_PACK_PROJECT_DIR="$PROJECT_DIR"
export POINTBENCH_PACK_OUTPUT="$OUTPUT"
export POINTBENCH_PACK_RUNTIME_DIR="$RUNTIME_DIR_FOR_PACKAGE"
export POINTBENCH_PACK_FRONTEND_NODE_MODULES="$FRONTEND_NODE_MODULES"

python3 <<'PY'
import os
import re
import zipfile
from pathlib import Path

root = Path(os.environ["POINTBENCH_PACK_PROJECT_DIR"]).resolve()
output = Path(os.environ["POINTBENCH_PACK_OUTPUT"]).resolve()
runtime_dir = Path(os.environ["POINTBENCH_PACK_RUNTIME_DIR"]).resolve()
frontend_node_modules = Path(os.environ["POINTBENCH_PACK_FRONTEND_NODE_MODULES"]).resolve()

include_items = [
    "start.bat",
    "run.bat",
    "run.vbs",
    "backend",
    "frontend",
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
        "runtime/",
        "offline-install/",
        "installers/",
    ]
    if any(rel == prefix[:-1] or rel.startswith(prefix) for prefix in skip_prefixes):
        return True
    if rel == "offline-install.zip":
        return True
    if re.match(r"^(PointBench-portable|test-point-web-portable)-.*\.zip$", rel):
        return True
    if "__pycache__/" in rel:
        return True
    if name.endswith((".pyc", ".pyo", ".db", ".db-journal", ".db-wal", ".tar.gz", ".tar.xz")):
        return True
    if name == "tsconfig.tsbuildinfo":
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
        print("[ERROR] zip verification failed. Missing entries:")
        for item in missing:
            print(f"  - {item}")
        raise SystemExit(1)
    forbidden = []
    for name in names:
        if name.endswith("/"):
            continue
        if any(pattern.search(name) for pattern in forbidden_patterns):
            forbidden.append(name)
    if forbidden:
        print("[ERROR] zip verification failed. Forbidden entries found:")
        for item in sorted(forbidden)[:50]:
            print(f"  - {item}")
        raise SystemExit(1)

size_mb = output.stat().st_size / 1024 / 1024
print(f"[OK] Created {output}")
print(f"[OK] Files: {files_added}")
print(f"[OK] Size: {size_mb:.1f} MB")
PY

DEPENDENCY_OUTPUT="$OUTPUT_DIR/${OUTPUT_NAME}-dependencies-windows-x64"
case "$DEPENDENCY_OUTPUT" in
  "$OUTPUT_DIR"/*) ;;
  *) fail "Refusing to replace a dependency directory outside the output directory" ;;
esac
rm -rf "$DEPENDENCY_OUTPUT"
mkdir -p "$DEPENDENCY_OUTPUT/frontend"
cp -a "$RUNTIME_DIR_FOR_PACKAGE" "$DEPENDENCY_OUTPUT/runtime"
cp -a "$FRONTEND_NODE_MODULES" "$DEPENDENCY_OUTPUT/frontend/node_modules"
cat > "$DEPENDENCY_OUTPUT/DEPENDENCIES.txt" <<'EOF'
PointBench portable dependencies
Platform: Windows x64
Format: unpacked directory (no compressed archives)
Merge this directory into the extracted PointBench code directory.
EOF

if find "$DEPENDENCY_OUTPUT" -type f \( \
  -iname '*.zip' -o -iname '*.whl' -o -iname '*.7z' -o -iname '*.rar' -o \
  -iname '*.tar' -o -iname '*.tgz' -o -iname '*.gz' -o -iname '*.xz' -o -iname '*.bz2' \
\) -print -quit | grep -q .; then
  find "$DEPENDENCY_OUTPUT" -type f \( \
    -iname '*.zip' -o -iname '*.whl' -o -iname '*.7z' -o -iname '*.rar' -o \
    -iname '*.tar' -o -iname '*.tgz' -o -iname '*.gz' -o -iname '*.xz' -o -iname '*.bz2' \
  \) -print
  fail "Unpacked dependency directory contains compressed archives"
fi

ok "Created code package: $OUTPUT"
ok "Created unpacked dependency directory: $DEPENDENCY_OUTPUT"
