param(
    [string]$ProjectDir,
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

function Resolve-FullPath([string]$Path) {
    [System.IO.Path]::GetFullPath($Path.TrimEnd('\', '/', '"', ' '))
}

function Test-CodeSkipPath([string]$RelativePath) {
    $path = $RelativePath.Replace('\', '/')
    $name = [System.IO.Path]::GetFileName($path)
    if ($path -match '(^|/)(\.git|\.offline-build|dist|runtime|logs|outputs|storage)(/|$)') { return $true }
    if ($path -match '^backend/(\.venv|storage|tests)(/|$)') { return $true }
    if ($path -match '^frontend/(node_modules|dist|\.vite)(/|$)') { return $true }
    if ($path -match '(^|/)(__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)(/|$)') { return $true }
    if ($path -match '^scripts/installer(/|$)') { return $true }
    if ($path -match '^scripts/(pack-|setup-portable|build-installers)') { return $true }
    if ($name -match '\.(pyc|pyo|db|db-journal|db-wal)$') { return $true }
    if ($name -eq 'tsconfig.tsbuildinfo') { return $true }
    return $false
}

function Get-CodeFiles([string]$Root) {
    $items = @('assets', 'backend', 'config', 'doc', 'frontend', 'sample_data', 'scripts')
    $selected = [System.Collections.Generic.List[object]]::new()
    foreach ($item in $items) {
        $source = Join-Path $Root $item
        if (-not (Test-Path -LiteralPath $source)) { continue }
        Get-ChildItem -LiteralPath $source -File -Recurse -Force | ForEach-Object {
            $relative = $_.FullName.Substring($Root.Length).TrimStart('\', '/')
            if (-not (Test-CodeSkipPath $relative)) {
                $selected.Add([pscustomobject]@{ Source = $_.FullName; Relative = $relative.Replace('\', '/') }) | Out-Null
            }
        }
    }
    @($selected | Sort-Object Relative)
}

function Get-DependencyFiles([string]$Root) {
    $selected = [System.Collections.Generic.List[object]]::new()
    foreach ($dependencyRoot in @((Join-Path $Root 'runtime'), (Join-Path $Root 'frontend\node_modules'))) {
        Get-ChildItem -LiteralPath $dependencyRoot -File -Recurse -Force | ForEach-Object {
            $relative = $_.FullName.Substring($Root.Length).TrimStart('\', '/')
            $selected.Add([pscustomobject]@{ Source = $_.FullName; Relative = $relative.Replace('\', '/') }) | Out-Null
        }
    }
    @($selected | Sort-Object Relative)
}

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function New-RawInstaller {
    param(
        [string]$HostPath,
        [string]$OutputPath,
        [string]$PackageType,
        [string]$Version,
        [string]$RequiredDependenciesVersion,
        [object[]]$Files
    )

    $outputFull = Resolve-FullPath $OutputPath
    if (Test-Path -LiteralPath $outputFull) { Remove-Item -LiteralPath $outputFull -Force }
    Copy-Item -LiteralPath $HostPath -Destination $outputFull -Force

    $manifest = [System.Collections.Generic.List[string]]::new()
    $manifest.Add("Type`t$PackageType")
    $manifest.Add('Product`tPointBench')
    $manifest.Add("Version`t$Version")
    $manifest.Add("RequiredDependenciesVersion`t$RequiredDependenciesVersion")
    $manifest.Add("Platform`twindows-x64")

    $output = [System.IO.File]::Open($outputFull, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $index = 0
        foreach ($file in $Files) {
            $index++
            if (($index % 500) -eq 0 -or $index -eq $Files.Count) {
                Write-Progress -Activity "Building $PackageType installer" -Status "$index / $($Files.Count)" -PercentComplete (($index * 100) / $Files.Count)
            }
            $length = (Get-Item -LiteralPath $file.Source).Length
            $hash = Get-Sha256 $file.Source
            $encodedPath = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($file.Relative))
            $manifest.Add("F`t$length`t$hash`t$encodedPath")
            $input = [System.IO.File]::OpenRead($file.Source)
            try { $input.CopyTo($output) } finally { $input.Dispose() }
        }
        Write-Progress -Activity "Building $PackageType installer" -Completed
        $manifestBytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes(($manifest -join "`n") + "`n")
        $output.Write($manifestBytes, 0, $manifestBytes.Length)
        $lengthBytes = [BitConverter]::GetBytes([long]$manifestBytes.Length)
        $output.Write($lengthBytes, 0, $lengthBytes.Length)
        $magic = [Text.Encoding]::ASCII.GetBytes('PBPKG001')
        $output.Write($magic, 0, $magic.Length)
    } finally {
        $output.Dispose()
    }

    $sizeMB = [math]::Round((Get-Item -LiteralPath $outputFull).Length / 1MB, 1)
    Write-Host "[OK] $PackageType installer: $outputFull ($sizeMB MB)" -ForegroundColor Green
}

if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    $ProjectDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..'
}
$root = Resolve-FullPath $ProjectDir
if ([string]::IsNullOrWhiteSpace($OutputDir)) { $OutputDir = Join-Path $root 'dist' }
$outputRoot = Resolve-FullPath $OutputDir
$buildRoot = Join-Path $root '.offline-build\installer'
$versionFile = Join-Path $root 'config\version.json'
$iconFile = Join-Path $root 'assets\PointBench.ico'
$hostSource = Join-Path $root 'scripts\installer\InstallerHost.cs'
$hostExe = Join-Path $buildRoot 'PointBenchInstallerHost.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

foreach ($required in @($versionFile, $iconFile, $hostSource, $csc, (Join-Path $root 'runtime\python\python.exe'), (Join-Path $root 'runtime\node\node.exe'), (Join-Path $root 'frontend\node_modules\vite\bin\vite.js'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required installer input is missing: $required" }
}

$versions = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($versions.codeVersion) -or [string]::IsNullOrWhiteSpace($versions.dependenciesVersion)) {
    throw 'config/version.json does not define codeVersion and dependenciesVersion.'
}

New-Item -ItemType Directory -Path $outputRoot, $buildRoot -Force | Out-Null
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 "/win32icon:$iconFile" "/out:$hostExe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll $hostSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostExe -PathType Leaf)) { throw 'Failed to compile the installer host.' }

$archivePatterns = @('*.zip', '*.whl', '*.7z', '*.rar', '*.tar', '*.tgz', '*.gz', '*.xz', '*.bz2')
$dependencyFiles = @(Get-DependencyFiles $root)
$forbiddenArchives = @($dependencyFiles | Where-Object { $name = [IO.Path]::GetFileName($_.Relative); @($archivePatterns | Where-Object { $name -like $_ }).Count -gt 0 })
if ($forbiddenArchives.Count -gt 0) { throw "Dependencies contain compressed archives: $($forbiddenArchives[0].Relative)" }

$codeFiles = @(Get-CodeFiles $root)
foreach ($requiredRelative in @('assets/PointBench.ico', 'backend/app/main.py', 'config/version.json', 'frontend/package.json', 'scripts/launcher.ps1', 'scripts/run.vbs')) {
    if ($requiredRelative -notin $codeFiles.Relative) { throw "Code installer input is missing: $requiredRelative" }
}

$dependencyOutput = Join-Path $outputRoot "PointBench-Dependencies-$($versions.dependenciesVersion).exe"
$codeOutput = Join-Path $outputRoot "PointBench-Code-$($versions.codeVersion).exe"
New-RawInstaller -HostPath $hostExe -OutputPath $dependencyOutput -PackageType 'dependencies' -Version $versions.dependenciesVersion -RequiredDependenciesVersion '' -Files $dependencyFiles
New-RawInstaller -HostPath $hostExe -OutputPath $codeOutput -PackageType 'code' -Version $versions.codeVersion -RequiredDependenciesVersion $versions.minimumDependenciesVersion -Files $codeFiles

Write-Host ''
Write-Host '[OK] Two non-admin PointBench installers are ready.' -ForegroundColor Green
Write-Host 'Install Dependencies first, then install Code.'
