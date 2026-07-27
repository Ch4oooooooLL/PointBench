param(
    [string]$ProjectDir,
    [string]$OutputDir,
    [string]$OutputName = 'PointBench-dependencies-windows-x64'
)

$ErrorActionPreference = 'Stop'

function Resolve-FullPath([string]$Path) {
    [System.IO.Path]::GetFullPath($Path.TrimEnd('\', '/', '"', ' '))
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Dependency verification failed: $FilePath" }
    } finally {
        Pop-Location
    }
}

if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    $ProjectDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..'
}
$root = Resolve-FullPath $ProjectDir
if ([string]::IsNullOrWhiteSpace($OutputDir)) { $OutputDir = Join-Path $root 'dist' }
$outputRoot = Resolve-FullPath $OutputDir
$output = Join-Path $outputRoot $OutputName
$pythonExe = Join-Path $root 'runtime\python\python.exe'
$nodeExe = Join-Path $root 'runtime\node\node.exe'
$nodeModules = Join-Path $root 'frontend\node_modules'
$viteEntry = Join-Path $nodeModules 'vite\bin\vite.js'

foreach ($required in @($pythonExe, $nodeExe, $viteEntry)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Portable dependency is missing: $required. Run scripts\setup-portable-deps.bat first."
    }
}

Invoke-Checked $pythonExe @(
    '-c', 'import fastapi,uvicorn,sqlalchemy,alembic,jose,pandas,numpy,openpyxl;print(1)'
) (Join-Path $root 'backend')
Invoke-Checked $nodeExe @($viteEntry, '--version') (Join-Path $root 'frontend')

$dependencyRoots = @((Join-Path $root 'runtime'), $nodeModules)
$archivePatterns = @('*.zip', '*.whl', '*.7z', '*.rar', '*.tar', '*.tgz', '*.gz', '*.xz', '*.bz2')
$archives = @(Get-ChildItem -LiteralPath $dependencyRoots -File -Recurse -Force | Where-Object {
    $name = $_.Name
    @($archivePatterns | Where-Object { $name -like $_ }).Count -gt 0
})
if ($archives.Count -gt 0) {
    Write-Host '[ERROR] Dependencies contain compressed archives:' -ForegroundColor Red
    $archives | ForEach-Object { Write-Host "  $($_.FullName)" }
    throw 'Remove or expand all dependency archives before packaging.'
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
if (Test-Path -LiteralPath $output) {
    $resolvedOutput = Resolve-FullPath $output
    if (-not $resolvedOutput.StartsWith($outputRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace a dependency directory outside the output root: $resolvedOutput"
    }
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $output 'frontend') -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $root 'runtime') -Destination (Join-Path $output 'runtime') -Recurse -Force
Copy-Item -LiteralPath $nodeModules -Destination (Join-Path $output 'frontend\node_modules') -Recurse -Force

$manifest = @(
    'PointBench portable dependencies'
    'Platform: Windows x64'
    'Format: unpacked directory (no compressed archives)'
    'Merge this directory into the extracted PointBench code directory.'
    "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')"
)
[System.IO.File]::WriteAllLines((Join-Path $output 'DEPENDENCIES.txt'), $manifest, (New-Object System.Text.UTF8Encoding $false))

$copiedArchives = @(Get-ChildItem -LiteralPath $output -File -Recurse -Force | Where-Object {
    $name = $_.Name
    @($archivePatterns | Where-Object { $name -like $_ }).Count -gt 0
})
if ($copiedArchives.Count -gt 0) { throw 'The generated dependency directory contains an archive.' }

$fileCount = @(Get-ChildItem -LiteralPath $output -File -Recurse -Force).Count
$size = (Get-ChildItem -LiteralPath $output -File -Recurse -Force | Measure-Object Length -Sum).Sum
$sizeMB = [math]::Round($size / 1MB, 1)
Write-Host "[OK] Uncompressed dependency directory: $output" -ForegroundColor Green
Write-Host "     Files: $fileCount; Size: $sizeMB MB"
Write-Output $output
