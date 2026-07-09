param(
    [Parameter(Mandatory=$false)]
    [string]$ProjectDir,

    [Parameter(Mandatory=$false)]
    [string]$OutputDir,

    [Parameter(Mandatory=$false)]
    [string]$OutputName = 'PointBench-portable'
)

$ErrorActionPreference = 'Stop'

function Resolve-FullPath {
    param([string]$Path)
    return [System.IO.Path]::GetFullPath($Path.TrimEnd('\', '/', '"', ' '))
}

function Fail {
    param([string]$Message)
    Write-Host ''
    Write-Host "[ERROR] $Message" -ForegroundColor Red
    Write-Host ''
    exit 1
}

function Require-File {
    param(
        [string]$Root,
        [string]$RelativePath
    )
    $path = Join-Path $Root $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Fail "Missing required file: $RelativePath"
    }
    return $path
}

function Require-Directory {
    param(
        [string]$Root,
        [string]$RelativePath
    )
    $path = Join-Path $Root $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        Fail "Missing required directory: $RelativePath"
    }
    return $path
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [string]$ErrorMessage
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    foreach ($argument in $Arguments) {
        [void]$psi.ArgumentList.Add($argument)
    }
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    if ($stdout) { Write-Host $stdout.TrimEnd() }
    if ($stderr) { Write-Host $stderr.TrimEnd() }
    if ($proc.ExitCode -ne 0) {
        Fail "$ErrorMessage ExitCode=$($proc.ExitCode)"
    }
}

function Test-SkipRelativePath {
    param([string]$RelativePath)

    $path = $RelativePath -replace '/', '\'
    $fileName = [System.IO.Path]::GetFileName($path)

    if ($path -match '(^|\\)\.git(\\|$)') { return $true }
    if ($path -match '(^|\\)__pycache__(\\|$)') { return $true }
    if ($path -match '(^|\\)\.pytest_cache(\\|$)') { return $true }
    if ($path -match '(^|\\)\.mypy_cache(\\|$)') { return $true }
    if ($path -match '(^|\\)\.ruff_cache(\\|$)') { return $true }
    if ($path -match '^logs(\\|$)') { return $true }
    if ($path -match '^outputs(\\|$)') { return $true }
    if ($path -match '^storage(\\|$)') { return $true }
    if ($path -match '^backend\\storage(\\|$)') { return $true }
    if ($path -match '^backend\\\.venv(\\|$)') { return $true }
    if ($path -match '^backend\\tests(\\|$)') { return $true }
    if ($path -match '^frontend\\dist(\\|$)') { return $true }
    if ($path -match '^frontend\\\.vite(\\|$)') { return $true }
    if ($path -match '^frontend\\node_modules\\\.cache(\\|$)') { return $true }
    if ($path -match '^runtime\\pip-packages(\\|$)') { return $true }
    if ($path -match '^runtime\\node-temp(\\|$)') { return $true }
    if ($path -match '^runtime\\install-deps\.bat$') { return $true }
    if ($path -match '^runtime\\setup-env\.bat$') { return $true }
    if ($path -match '^runtime\\get-pip\.py$') { return $true }
    if ($path -match '^offline-install(\\|$)') { return $true }
    if ($path -match '^installers(\\|$)') { return $true }
    if ($path -match '^(PointBench-portable|test-point-web-portable)-.*\.zip$') { return $true }
    if ($path -eq 'offline-install.zip') { return $true }

    if ($fileName -like '*.pyc') { return $true }
    if ($fileName -like '*.pyo') { return $true }
    if ($fileName -like '*.db') { return $true }
    if ($fileName -like '*.db-journal') { return $true }
    if ($fileName -like '*.db-wal') { return $true }
    if ($fileName -like '*.tar.gz') { return $true }
    if ($fileName -like '*.tar.xz') { return $true }
    if ($fileName -eq 'python-embed.zip') { return $true }
    if ($fileName -eq 'nodejs.zip') { return $true }
    if ($fileName -eq 'tsconfig.tsbuildinfo') { return $true }

    return $false
}

function Add-FileToZip {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$SourcePath,
        [string]$EntryPath
    )

    $normalizedEntryPath = $EntryPath.Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $Archive,
        $SourcePath,
        $normalizedEntryPath,
        [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
}

if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    $ProjectDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..'
}
$root = Resolve-FullPath $ProjectDir

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = $root
}
$outputRoot = Resolve-FullPath $OutputDir
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$pythonExe = Require-File $root 'runtime\python\python.exe'
$nodeExe = Require-File $root 'runtime\node\node.exe'
$viteEntry = Require-File $root 'frontend\node_modules\vite\bin\vite.js'
Require-Directory $root 'frontend\node_modules' | Out-Null
Require-Directory $root 'backend\app' | Out-Null
Require-Directory $root 'backend\alembic' | Out-Null

$requiredFiles = @(
    'start.bat',
    'run.bat',
    'run.vbs',
    'scripts\launcher.ps1',
    'scripts\preflight_check.py',
    'scripts\pack-portable.bat',
    'scripts\pack-portable.ps1',
    'backend\requirements.txt',
    'backend\alembic.ini',
    'backend\app\main.py',
    'backend\app\database.py',
    'backend\app\models.py',
    'frontend\package.json',
    'frontend\package-lock.json',
    'frontend\node_modules\vite\bin\vite.js',
    'runtime\python\python.exe',
    'runtime\node\node.exe'
)
foreach ($file in $requiredFiles) {
    Require-File $root $file | Out-Null
}

Write-Host '========================================'
Write-Host '  Pack PointBench Windows Portable'
Write-Host '========================================'
Write-Host ''
Write-Host "  Project root: $root"
Write-Host "  Output dir:   $outputRoot"
Write-Host ''

Write-Host '  Verifying unpacked portable dependencies...'
Invoke-Checked `
    -FilePath $pythonExe `
    -Arguments @('-c', "import fastapi, uvicorn, sqlalchemy; import alembic.config; import jose; import pandas, numpy, openpyxl; print('  [OK] Python dependencies import correctly')") `
    -WorkingDirectory (Join-Path $root 'backend') `
    -ErrorMessage 'Portable Python dependency check failed.'

Invoke-Checked `
    -FilePath $nodeExe `
    -Arguments @($viteEntry, '--version') `
    -WorkingDirectory (Join-Path $root 'frontend') `
    -ErrorMessage 'Portable frontend dependency check failed.'

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$output = Join-Path $outputRoot "$OutputName-$timestamp.zip"
if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Force
}

$includeItems = @(
    'start.bat',
    'run.bat',
    'run.vbs',
    'backend',
    'frontend',
    'runtime',
    'scripts',
    'doc',
    'sample_data'
)

$files = New-Object System.Collections.Generic.List[object]
foreach ($item in $includeItems) {
    $path = Join-Path $root $item
    if (-not (Test-Path -LiteralPath $path)) {
        continue
    }

    if (Test-Path -LiteralPath $path -PathType Leaf) {
        if (-not (Test-SkipRelativePath $item)) {
            $files.Add([PSCustomObject]@{ Source = $path; Entry = $item }) | Out-Null
        }
        continue
    }

    Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
        $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/')
        if (-not (Test-SkipRelativePath $relative)) {
            $files.Add([PSCustomObject]@{ Source = $_.FullName; Entry = $relative }) | Out-Null
        }
    }
}

if ($files.Count -eq 0) {
    Fail 'No files were selected for the portable package.'
}

Write-Host ''
Write-Host "  Creating zip with $($files.Count) files..."
Write-Host "  Output: $output"

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $count = 0
    foreach ($file in $files) {
        Add-FileToZip -Archive $archive -SourcePath $file.Source -EntryPath $file.Entry
        $count++
        if (($count % 1000 -eq 0) -or ($count -eq $files.Count)) {
            $percent = [math]::Round(100 * $count / $files.Count)
            Write-Host "  Progress: $count/$($files.Count) ($percent%)"
        }
    }

    $emptyDirectories = @(
        'logs/',
        'backend/storage/',
        'backend/storage/imports/',
        'backend/storage/projects/',
        'backend/storage/dewesoft/',
        'backend/storage/temp/',
        'backend/storage/delete_exports/'
    )
    foreach ($directory in $emptyDirectories) {
        $archive.CreateEntry($directory) | Out-Null
    }
} finally {
    $archive.Dispose()
}

$requiredEntries = @(
    'start.bat',
    'run.bat',
    'run.vbs',
    'scripts/launcher.ps1',
    'scripts/preflight_check.py',
    'backend/app/main.py',
    'backend/app/database.py',
    'backend/alembic.ini',
    'frontend/package.json',
    'frontend/node_modules/vite/bin/vite.js',
    'runtime/python/python.exe',
    'runtime/node/node.exe',
    'logs/',
    'backend/storage/'
)

$forbiddenEntryPatterns = @(
    '^\.git/',
    '^backend/tests/',
    '^backend/\.venv/',
    '^backend/storage/.+',
    '^frontend/dist/',
    '^runtime/get-pip\.py$',
    '^runtime/install-deps\.bat$',
    '^runtime/pip-packages/',
    '^offline-install/',
    '^logs/.+',
    '__pycache__/',
    '\.pyc$',
    '\.db$',
    '^(PointBench-portable|test-point-web-portable)-.*\.zip$'
)

$zip = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
    $entryNames = @($zip.Entries | ForEach-Object { $_.FullName })
    $missingEntries = @($requiredEntries | Where-Object { $entryNames -notcontains $_ })
    if ($missingEntries.Count -gt 0) {
        Write-Host ''
        Write-Host '[ERROR] Zip verification failed. Missing entries:' -ForegroundColor Red
        foreach ($item in $missingEntries) {
            Write-Host "  - $item"
        }
        exit 1
    }

    $forbiddenEntries = @()
    foreach ($entry in $entryNames) {
        if ($entry.EndsWith('/')) {
            continue
        }
        foreach ($pattern in $forbiddenEntryPatterns) {
            if ($entry -match $pattern) {
                $forbiddenEntries += $entry
                break
            }
        }
    }
    if ($forbiddenEntries.Count -gt 0) {
        Write-Host ''
        Write-Host '[ERROR] Zip verification failed. Forbidden entries found:' -ForegroundColor Red
        foreach ($item in ($forbiddenEntries | Select-Object -First 50)) {
            Write-Host "  - $item"
        }
        exit 1
    }
} finally {
    $zip.Dispose()
}

$sizeMB = [math]::Round((Get-Item -LiteralPath $output).Length / 1MB, 1)

Write-Host ''
Write-Host '========================================'
Write-Host '  Pack complete'
Write-Host '========================================'
Write-Host ''
Write-Host "  Output: $output"
Write-Host "  Size:   ${sizeMB} MB"
Write-Host ''
Write-Host '  Usage on Windows: extract the zip and run start.bat.'
Write-Host '  The package uses only unpacked runtime\ and frontend\node_modules dependencies.'
Write-Host ''
