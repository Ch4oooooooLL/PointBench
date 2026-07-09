#!/usr/bin/env bash
set -Eeuo pipefail

# Pack the current project as a portable distribution.
# Dependencies must already be unpacked under runtime/ and frontend/node_modules.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || {
  echo "[ERROR] Invalid project directory: ${1:-}"
  exit 1
}
OUTPUT_NAME="${2:-test-point-web-portable}"

fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
info() { printf '[OK] %s\n' "$*"; }

PYTHON_EXE="$PROJECT_DIR/runtime/python/python.exe"
NODE_EXE="$PROJECT_DIR/runtime/node/node.exe"
VITE_ENTRY="$PROJECT_DIR/frontend/node_modules/vite/bin/vite.js"

[[ -f "$PYTHON_EXE" ]] || fail "missing portable Python: runtime/python/python.exe"
[[ -f "$NODE_EXE" ]] || fail "missing portable Node.js: runtime/node/node.exe"
[[ -f "$VITE_ENTRY" ]] || fail "missing frontend dependencies: frontend/node_modules/vite/bin/vite.js"

if [[ -x "$PYTHON_EXE" ]]; then
  "$PYTHON_EXE" -c "import fastapi, uvicorn, sqlalchemy; import alembic.config; import jose; import pandas, numpy, openpyxl; print('Python deps ok')" || \
    fail "portable Python dependencies are incomplete"
else
  info "Python dependency import check skipped because runtime/python/python.exe is not executable on this host."
fi

if [[ -x "$NODE_EXE" ]]; then
  "$NODE_EXE" "$VITE_ENTRY" --version >/dev/null || fail "frontend node_modules are incomplete"
else
  info "Node dependency check skipped because runtime/node/node.exe is not executable on this host."
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT="$PROJECT_DIR/${OUTPUT_NAME}-${TIMESTAMP}.zip"

command -v zip >/dev/null 2>&1 || fail "zip is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required for zip verification"

echo "========================================"
echo "  Pack PointBench Portable"
echo "========================================"
echo "  Project: $PROJECT_DIR"
echo "  Output:  $OUTPUT"
echo

cd "$PROJECT_DIR"

FILES=()
while IFS= read -r -d '' file; do
  rel="${file#./}"
  case "$rel" in
    .git|.git/*|\
    __pycache__|*/__pycache__|*/__pycache__/*|\
    *.pyc|*.pyo|*.db|*.db-journal|*.db-wal|\
    storage|storage/*|backend/storage/*|outputs|outputs/*|logs|logs/*|\
    offline-install|offline-install/*|installers|installers/*|\
    runtime/get-pip.py|runtime/install-deps.bat|runtime/pip-packages|runtime/pip-packages/*|\
    runtime/python-embed.zip|runtime/nodejs.zip|runtime/node-temp|runtime/node-temp/*|\
    frontend/node_modules/.cache|frontend/node_modules/.cache/*|\
    frontend/dist|frontend/dist/*|frontend/.vite|frontend/.vite/*|\
    backend/.venv|backend/.venv/*|\
    *.zip|*.tar.gz|*.tar.xz|.DS_Store|*.swp|*.swo|*~)
      continue
      ;;
  esac
  FILES+=("$rel")
done < <(find . -type f -print0)

printf '%s\n' "${FILES[@]}" | zip -q "$OUTPUT" -@ || fail "failed to create zip"

python3 - "$OUTPUT" <<'PY'
import sys
import zipfile

required = {
    "start.bat",
    "run.bat",
    "run.sh",
    "scripts/launcher.ps1",
    "scripts/preflight_check.py",
    "backend/app/main.py",
    "backend/alembic.ini",
    "frontend/package.json",
    "frontend/node_modules/vite/bin/vite.js",
    "runtime/python/python.exe",
    "runtime/node/node.exe",
}
with zipfile.ZipFile(sys.argv[1]) as archive:
    names = set(archive.namelist())
missing = sorted(required - names)
if missing:
    print("[ERROR] zip verification failed. Missing entries:")
    for item in missing:
        print(f"  - {item}")
    raise SystemExit(1)
PY

SIZE="$(du -h "$OUTPUT" | cut -f1)"
echo
echo "Pack complete: $OUTPUT"
echo "Size: $SIZE"
echo
echo "The zip is portable-only: extract it and launch start.bat."
echo "No installer, first-run dependency bootstrap, system Python, or system Node.js is required."
