param(
    [Parameter(Mandatory=$false)]
    [string]$ProjectDir,

    [Parameter(Mandatory=$false)]
    [string]$OutputName = 'test-point-web-portable'
)

$ErrorActionPreference = 'Stop'

# ============================================================
#  Pack portable distribution zip.
#  The package must already contain unpacked runtime dependencies under
#  runtime/ and frontend/node_modules. No installer/bootstrap files are used.
# ============================================================

if (-not $ProjectDir) {
    $ProjectDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..'
}
$root = [System.IO.Path]::GetFullPath($ProjectDir.TrimEnd('\', '/', '"', ' '))

# Check that runtime/ exists
$runtimeDir = Join-Path $root 'runtime'
if (-not (Test-Path $runtimeDir)) {
    Write-Host ''
    Write-Host "[ERROR] runtime\ directory not found."
    Write-Host ''
    Write-Host "  The portable package must include unpacked runtime dependencies."
    Write-Host ''
    exit 1
}

if (-not (Test-Path (Join-Path $runtimeDir 'python\python.exe'))) {
    Write-Host ''
    Write-Host "[ERROR] Portable Python not found: runtime\python\python.exe"
    Write-Host "  Use a complete portable package with runtime\python unpacked."
    Write-Host ''
    exit 1
}

if (-not (Test-Path (Join-Path $runtimeDir 'node\node.exe'))) {
    Write-Host ''
    Write-Host "[ERROR] Portable Node.js not found: runtime\node\node.exe"
    Write-Host "  Use a complete portable package with runtime\node unpacked."
    Write-Host ''
    exit 1
}

if (-not (Test-Path (Join-Path $root 'frontend\node_modules\vite\bin\vite.js'))) {
    Write-Host ''
    Write-Host "[ERROR] Frontend dependencies not found: frontend\node_modules\vite\bin\vite.js"
    Write-Host "  Use a complete portable package with frontend\node_modules unpacked."
    Write-Host ''
    exit 1
}

Write-Host '  Verifying unpacked runtime dependencies...'
& (Join-Path $runtimeDir 'python\python.exe') -c "import fastapi, uvicorn, sqlalchemy; import alembic.config; import jose; import pandas, numpy, openpyxl; print('  [OK] Python runtime dependencies verified')"
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '[ERROR] Portable Python dependencies are incomplete.'
    Write-Host '  Rebuild runtime\python before packaging; the portable launcher will not install dependencies.'
    Write-Host ''
    exit 1
}
& (Join-Path $runtimeDir 'node\node.exe') (Join-Path $root 'frontend\node_modules\vite\bin\vite.js') --version
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '[ERROR] Frontend node_modules are incomplete.'
    Write-Host '  Rebuild frontend\node_modules before packaging; the portable launcher will not install dependencies.'
    Write-Host ''
    exit 1
}

$requiredFiles = @(
    'start.bat',
    'run.bat',
    'scripts\launcher.ps1',
    'scripts\preflight_check.py',
    'backend\requirements.txt',
    'backend\alembic.ini',
    'backend\app\__init__.py',
    'backend\app\main.py',
    'backend\app\database.py',
    'backend\app\models.py',
    'frontend\package.json',
    'frontend\package-lock.json',
    'frontend\node_modules\vite\bin\vite.js',
    'runtime\python\python.exe',
    'runtime\node\node.exe'
)
$missingRequiredFiles = @($requiredFiles | Where-Object { -not (Test-Path (Join-Path $root $_)) })
if ($missingRequiredFiles.Count -gt 0) {
    Write-Host ''
    Write-Host '[ERROR] Portable package is incomplete. Missing required files:'
    foreach ($item in $missingRequiredFiles) {
        Write-Host "  - $item"
    }
    Write-Host ''
    exit 1
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$output = Join-Path $root "$OutputName-$timestamp.zip"

Write-Host '========================================'
Write-Host '  Pack Portable Distribution'
Write-Host '========================================'
Write-Host ''
Write-Host "  Project root: $root"
Write-Host "  Output:       $output"
Write-Host ''

if (Test-Path $output) {
    Remove-Item $output -Force
}

# Exclusion patterns
$exclude = @(
    '*\.git\*',
    '*\.git',
    '*\__pycache__\*',
    '*\__pycache__',
    '*.pyc',
    '*.db',
    '*.db-journal',
    '*.db-wal',
    '*\storage\*',
    '*\outputs\*',
    '*\logs\*',
    '*\logs',
    '*\offline-install\*',
    '*\offline-install',
    '*\installers\*',
    '*\installers',
    '*\pip-packages\*',
    '*\pip-packages',
    '*\node_modules\.cache\*',
    '*\.vite\*',
    '*\dist\*',
    '*\dist',
    '*.zip',
    '*.tar.gz',
    '*\node_modules\.cache',
    '*\backend\.venv\*',
    '*\backend\.venv',
    '*\get-pip.py',
    '*\runtime\install-deps.bat',
    '*\runtime\pip-packages\*',
    '*\runtime\pip-packages',
    '*\python-embed.zip',
    '*\nodejs.zip',
    '*\node-temp\*',
    '*\node-temp'
)

Write-Host '  Collecting files...'
Write-Host '  (excluding: .git, installer/bootstrap files, caches, storage, outputs, logs, dist)'
Write-Host ''

$allFiles = @(Get-ChildItem -Path $root -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object {
    $full = $_.FullName
    foreach ($pat in $exclude) {
        if ($full -like $pat) { return $false }
    }
    try {
        $fs = [System.IO.File]::Open($full, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $fs.Close()
    } catch {
        Write-Host "  [SKIP] locked: $full"
        return $false
    }
    return $true
})

Write-Host "  Compressing $($allFiles.Count) files..."
Write-Host ''

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($output, 'Create')
$count = 0
$total = $allFiles.Count

foreach ($f in $allFiles) {
    $entryPath = $f.FullName.Substring($root.Length).TrimStart('\', '/')
    try {
        $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $entryPath)
    } catch {
        Write-Host "  [SKIP] $entryPath : $_"
    }
    $count++
    if (($count % 1000 -eq 0) -or ($count -eq $total)) {
        $pct = [math]::Round(100 * $count / $total)
        Write-Host "  Progress: $count/$total ($pct%)"
    }
}

$requiredDirectories = @(
    'logs/',
    'storage/',
    'backend/storage/',
    'backend/storage/imports/',
    'backend/storage/projects/',
    'backend/storage/dewesoft/',
    'backend/storage/temp/',
    'backend/storage/delete_exports/'
)
foreach ($dir in $requiredDirectories) {
    try {
        $null = $archive.CreateEntry($dir)
    } catch {
        Write-Host "  [WARN] Could not add directory entry $dir : $_"
    }
}
$archive.Dispose()

if (-not (Test-Path $output)) {
    Write-Host ''
    Write-Host '[ERROR] Failed to create zip file.'
    exit 1
}

$requiredEntries = @(
    'start.bat',
    'run.bat',
    'scripts/launcher.ps1',
    'scripts/preflight_check.py',
    'backend/app/__init__.py',
    'backend/app/main.py',
    'backend/app/database.py',
    'backend/app/models.py',
    'backend/alembic.ini',
    'frontend/package.json',
    'frontend/node_modules/vite/bin/vite.js',
    'runtime/python/python.exe',
    'runtime/node/node.exe',
    'logs/',
    'storage/',
    'backend/storage/'
)
$zip = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
    $entryNames = @($zip.Entries | ForEach-Object { $_.FullName })
    $missingEntries = @($requiredEntries | Where-Object { $entryNames -notcontains $_ })
    if ($missingEntries.Count -gt 0) {
        Write-Host ''
        Write-Host '[ERROR] Zip verification failed. Missing entries:'
        foreach ($item in $missingEntries) {
            Write-Host "  - $item"
        }
        Write-Host ''
        exit 1
    }
} finally {
    $zip.Dispose()
}

$sizeMB = [math]::Round((Get-Item $output).Length / 1MB, 1)

Write-Host ''
Write-Host '========================================'
Write-Host '  Pack complete!'
Write-Host '========================================'
Write-Host ''
Write-Host "  Output:  $output"
Write-Host "  Size:    ${sizeMB} MB"
Write-Host ''
Write-Host '  Included in this zip:'
Write-Host '    runtime\              — unpacked portable Python + Node.js + Python deps'
Write-Host '    backend\              — Python source code'
Write-Host '    frontend\             — React source + node_modules'
Write-Host '    scripts\              — launcher and utility scripts'
Write-Host '    sample_data\          — sample data files'
Write-Host '    doc\                  — documentation'
Write-Host '    start.bat             — one-click launcher'
Write-Host ''
Write-Host '  Excluded:'
Write-Host '    .git\                 — version control'
Write-Host '    __pycache__\, .pyc    — bytecode cache'
Write-Host '    storage\, outputs\    — runtime data'
Write-Host '    installer/bootstrap files — offline-install\, get-pip.py, install-deps.bat'
Write-Host '    logs\                 — log files'
Write-Host '    dist\                 — build artifacts'
Write-Host ''
Write-Host '  How to use on the offline PC:'
Write-Host '    1. Copy the zip to the target computer'
Write-Host '    2. Extract to any folder'
Write-Host '    3. Double-click start.bat'
Write-Host ''
Write-Host '  No installation. No internet. No admin rights.'
Write-Host '  Everything is self-contained.'
Write-Host ''
