param(
    [string]$ProjectDir,
    [string]$OutputDir,
    [string]$OutputName = 'PointBench-code'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Resolve-FullPath([string]$Path) {
    [System.IO.Path]::GetFullPath($Path.TrimEnd('\', '/', '"', ' '))
}

function Test-SkipPath([string]$RelativePath) {
    $path = $RelativePath.Replace('\', '/')
    $name = [System.IO.Path]::GetFileName($path)
    if ($path -match '(^|/)\.git(/|$)') { return $true }
    if ($path -match '(^|/)(runtime|logs|outputs|storage)(/|$)') { return $true }
    if ($path -match '^backend/(\.venv|storage|tests)(/|$)') { return $true }
    if ($path -match '^frontend/(node_modules|dist|\.vite)(/|$)') { return $true }
    if ($path -match '(^|/)(__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)(/|$)') { return $true }
    if ($path -match '^dist(/|$)') { return $true }
    if ($name -match '\.(pyc|pyo|db|db-journal|db-wal)$') { return $true }
    if ($name -eq 'tsconfig.tsbuildinfo') { return $true }
    return $false
}

if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    $ProjectDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..'
}
$root = Resolve-FullPath $ProjectDir
if ([string]::IsNullOrWhiteSpace($OutputDir)) { $OutputDir = Join-Path $root 'dist' }
$outputRoot = Resolve-FullPath $OutputDir
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$output = Join-Path $outputRoot "$OutputName-$timestamp.zip"
$includeItems = @('assets', 'backend', 'config', 'frontend', 'scripts', 'doc', 'sample_data')
$files = [System.Collections.Generic.List[object]]::new()

foreach ($item in $includeItems) {
    $source = Join-Path $root $item
    if (-not (Test-Path -LiteralPath $source)) { continue }
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        if (-not (Test-SkipPath $item)) { $files.Add([pscustomobject]@{ Source = $source; Entry = $item }) | Out-Null }
        continue
    }
    Get-ChildItem -LiteralPath $source -File -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/')
        if (-not (Test-SkipPath $relative)) {
            $files.Add([pscustomobject]@{ Source = $_.FullName; Entry = $relative }) | Out-Null
        }
    }
}

if ($files.Count -eq 0) { throw 'No source files were selected.' }
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
$archive = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $file.Source, $file.Entry.Replace('\', '/'),
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
    foreach ($directory in @('logs/', 'backend/storage/', 'backend/storage/imports/', 'backend/storage/projects/', 'backend/storage/dewesoft/', 'backend/storage/temp/', 'backend/storage/delete_exports/')) {
        $archive.CreateEntry($directory) | Out-Null
    }
} finally {
    $archive.Dispose()
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
    $names = @($zip.Entries.FullName)
    foreach ($required in @('assets/PointBench.ico', 'scripts/start.bat', 'scripts/run.vbs', 'scripts/launcher.ps1', 'scripts/setup-portable-deps.ps1', 'backend/app/main.py', 'frontend/package.json')) {
        if ($names -notcontains $required) { throw "Code package is missing: $required" }
    }
    if (@($names | Where-Object { $_ -match '(^|/)(runtime|node_modules)(/|$)' }).Count -gt 0) {
        throw 'Code package unexpectedly contains dependencies.'
    }
} finally {
    $zip.Dispose()
}

Write-Host "[OK] Code package: $output" -ForegroundColor Green
Write-Output $output
