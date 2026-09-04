<#
.SYNOPSIS
    (Re)generate runtime\runtime-manifest.json - the dependency fingerprint.

.DESCRIPTION
    Scans the portable runtime (runtime\python, runtime\node) and the shared
    frontend node_modules, records interpreter versions and per-file SHA-256,
    then writes runtime\runtime-manifest.json.  The SHA-256 of this manifest
    is the source of truth used by the packaging pipeline (scripts\packup.ps1
    and scripts\build-installers.ps1) to decide whether an existing
    dependency installer can be reused.

    Run this script after manually changing the portable dependencies.  The
    dependency setup script runs it automatically after a fresh setup.
#>

[CmdletBinding()]
param(
    [string]$ProjectDir = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-FullPath([string]$Path) {
    [System.IO.Path]::GetFullPath($Path.TrimEnd('\', '/', '"', ' '))
}

function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    $ProjectDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..'
}
$root = Resolve-FullPath $ProjectDir
$pythonExe = Join-Path $root 'runtime\python\python.exe'
$nodeExe = Join-Path $root 'runtime\node\node.exe'
$nodeModules = Join-Path $root 'frontend\node_modules'
$manifestPath = Join-Path $root 'runtime\runtime-manifest.json'

foreach ($required in @($pythonExe, $nodeExe)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "便携运行时缺失：$required。请先运行 scripts\setup-portable-deps.bat 安装依赖。"
    }
}
if (-not (Test-Path -LiteralPath $nodeModules -PathType Container)) {
    throw "前端依赖缺失：$nodeModules。请先运行 scripts\setup-portable-deps.bat 安装依赖。"
}

Write-Host '正在读取便携运行时版本...'
$pythonVersion = (& $pythonExe -V 2>&1 | Out-String).Trim()
if ($pythonVersion -notmatch '\d+\.\d+(\.\d+)?') {
    $pythonVersion = 'unknown'
} else {
    $pythonVersion = $Matches[0]
}
$nodeVersion = (& $nodeExe --version 2>&1 | Out-String).Trim()
if ($nodeVersion -notmatch '^v') { $nodeVersion = 'v' + $nodeVersion }
$npmVersion = $null
$npmPackage = Join-Path $root 'runtime\node\node_modules\npm\package.json'
if (Test-Path -LiteralPath $npmPackage -PathType Leaf) {
    $npmVersion = (Get-Content -LiteralPath $npmPackage -Raw -Encoding UTF8 | ConvertFrom-Json).version
}
if ([string]::IsNullOrWhiteSpace($npmVersion)) { $npmVersion = 'unknown' }

Write-Host '正在扫描便携运行时与前端依赖（生成文件指纹）...'
$fileRecords = [ordered]@{}
$total = 0
foreach ($scanRoot in @((Join-Path $root 'runtime'), $nodeModules)) {
    if (-not (Test-Path -LiteralPath $scanRoot -PathType Container)) { continue }
    Get-ChildItem -LiteralPath $scanRoot -File -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
        if ($relative -eq 'runtime/runtime-manifest.json') { return }
        # Embedded Python ships its standard library as flat .pyc files
        # (Lib\encodings\*.pyc etc.); they are required runtime modules.  Only
        # real caches are excluded here, keeping the fingerprint identical to
        # what scripts\build-installers.ps1 packages.
        if ($relative -match '^frontend/node_modules/\.vite/' -or $relative -match '(^|/)__pycache__(/|$)') { return }
        $fileRecords[$relative] = [ordered]@{
            sha256 = (Get-Sha256 $_.FullName)
            size_bytes = [int64]$_.Length
        }
        $total++
        if (($total % 5000) -eq 0) { Write-Host "  已扫描 $total 个文件" }
    }
}

$sorted = [ordered]@{}
foreach ($key in ($fileRecords.Keys | Sort-Object)) { $sorted[$key] = $fileRecords[$key] }

$manifest = [ordered]@{
    schema_version = 1
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    overall = 'PASS'
    python = [ordered]@{
        version = $pythonVersion
        executable = 'python/python.exe'
    }
    node = [ordered]@{
        version = $nodeVersion
        executable = 'node/node.exe'
        npm_executable = 'node/npm.cmd'
        npm_version = $npmVersion
    }
    scan = [ordered]@{
        file_count = $total
        roots = @('runtime', 'frontend/node_modules')
    }
    excluded = @(
        'runtime/runtime-manifest.json is not self-hashed in files',
        'frontend/node_modules/.vite',
        '__pycache__'
    )
    files = $sorted
}

New-Item -ItemType Directory -Path (Split-Path -Parent $manifestPath) -Force | Out-Null
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding $false))
$sizeMB = [math]::Round((Get-Item -LiteralPath $manifestPath).Length / 1MB, 2)
Write-Host "[OK] 运行时指纹清单：$manifestPath"
Write-Host "     文件数：$total；大小：$sizeMB MB"
Write-Output $manifestPath
