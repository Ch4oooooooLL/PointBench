param(
    [string]$ProjectDir,
    [string]$OutputDir,
    [string]$Timestamp,

    [ValidateSet('Code', 'Dependencies', 'All')]
    [string]$Package = 'Code',

    [switch]$ForceDependencies
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
    if ($path -match '^scripts/(pack-|packup|update-runtime-manifest|setup-portable|build-)') { return $true }
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
            $normalized = $relative.Replace('\', '/')
            # The embedded Python standard library is expanded from
            # python312.zip into flat .pyc files (Lib\encodings\*.pyc etc.);
            # those are the shipped module form, not caches, so they must be
            # packaged.  Only real caches are excluded: vite prebuild and
            # __pycache__ directories.
            if ($normalized -match '^frontend/node_modules/\.vite/' -or $normalized -match '(^|/)__pycache__(/|$)') { return }
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

function Get-RuntimeManifestHash([string]$Root) {
    $manifest = Join-Path $Root 'runtime\runtime-manifest.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        throw "Runtime manifest is missing: $manifest. Run scripts\update-runtime-manifest.ps1 or scripts\setup-portable-deps.bat first."
    }
    return (Get-Sha256 $manifest)
}

function New-RawInstaller {
    param(
        [string]$HostPath,
        [string]$OutputPath,
        [string]$PackageType,
        [string]$Version,
        [string]$RequiredDependenciesVersion,
        [object[]]$Files,
        [System.Collections.IDictionary]$ExtraManifestFields
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
    if ($ExtraManifestFields) {
        foreach ($key in $ExtraManifestFields.Keys) {
            $manifest.Add("$key`t$($ExtraManifestFields[$key])")
        }
    }

    $output = [System.IO.File]::Open($outputFull, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $index = 0
        foreach ($file in $Files) {
            $index++
            if (($index % 500) -eq 0 -or $index -eq $Files.Count) {
                Write-Progress -Activity "Building $PackageType installer" -Status "$index / $($Files.Count)" -PercentComplete (($index * 100) / $Files.Count)
            }
            $length = if ($null -ne $file.LengthBytes) { $file.LengthBytes } else { (Get-Item -LiteralPath $file.Source).Length }
            $hash = if ($file.Sha256) { $file.Sha256 } else { Get-Sha256 $file.Source }
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

$buildCode = $Package -in @('Code', 'All')
$buildDependencies = $Package -in @('Dependencies', 'All')

foreach ($required in @($versionFile, $iconFile, $hostSource, $csc)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required installer input is missing: $required" }
}
if ($buildDependencies) {
    foreach ($required in @((Join-Path $root 'runtime\python\python.exe'), (Join-Path $root 'runtime\node\node.exe'), (Join-Path $root 'frontend\node_modules\vite\bin\vite.js'))) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required dependency input is missing: $required" }
    }
}

if ([string]::IsNullOrWhiteSpace($Timestamp)) {
    $resolvedTimestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
} else {
    $resolvedTimestamp = $Timestamp
}
if ($resolvedTimestamp -notmatch '^\d{8}T\d{6}Z$') { throw "Invalid Timestamp: $resolvedTimestamp" }

$versions = Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($versions.codeVersion) -or [string]::IsNullOrWhiteSpace($versions.dependenciesVersion)) {
    throw 'config/version.json does not define codeVersion and dependenciesVersion.'
}
if ([string]::IsNullOrWhiteSpace($versions.minimumDependenciesVersion)) {
    throw 'config/version.json does not define minimumDependenciesVersion.'
}
if ($versions.minimumDependenciesVersion -cne $versions.dependenciesVersion) {
    throw ("minimumDependenciesVersion ({0}) must equal dependenciesVersion ({1}): the installer host requires an exact match." -f $versions.minimumDependenciesVersion, $versions.dependenciesVersion)
}

New-Item -ItemType Directory -Path $outputRoot, $buildRoot -Force | Out-Null
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 "/win32icon:$iconFile" "/out:$hostExe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll $hostSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostExe -PathType Leaf)) { throw 'Failed to compile the installer host.' }

$dependencyOutput = Join-Path $outputRoot "PointBench-Dependencies-$($versions.dependenciesVersion).exe"
$codeOutput = Join-Path $outputRoot "PointBench-Code-$($versions.codeVersion).exe"

if ($buildDependencies) {
    if ((Test-Path -LiteralPath $dependencyOutput -PathType Leaf) -and -not $ForceDependencies) {
        Write-Host "[SKIP] Dependency installer already exists for version $($versions.dependenciesVersion)." -ForegroundColor Yellow
        Write-Host '       Use scripts\packup.ps1 for metadata-aware reuse decisions, or pass -ForceDependencies to rebuild.'
    } else {
        $runtimeManifestHash = Get-RuntimeManifestHash $root
        $runtimeManifest = Get-Content -LiteralPath (Join-Path $root 'runtime\runtime-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json

        $archivePatterns = @('*.zip', '*.whl', '*.7z', '*.rar', '*.tar', '*.tgz', '*.gz', '*.xz', '*.bz2')
        $dependencyFiles = @(Get-DependencyFiles $root)
        $forbiddenArchives = @($dependencyFiles | Where-Object { $name = [IO.Path]::GetFileName($_.Relative); @($archivePatterns | Where-Object { $name -like $_ }).Count -gt 0 })
        if ($forbiddenArchives.Count -gt 0) { throw "Dependencies contain compressed archives: $($forbiddenArchives[0].Relative)" }

        $records = New-Object System.Collections.Generic.List[object]
        foreach ($file in $dependencyFiles) {
            $length = (Get-Item -LiteralPath $file.Source).Length
            $hash = Get-Sha256 $file.Source
            $file | Add-Member -NotePropertyName LengthBytes -NotePropertyValue ([int64]$length) -Force
            $file | Add-Member -NotePropertyName Sha256 -NotePropertyValue $hash -Force
            [void]$records.Add([ordered]@{ path = $file.Relative.Replace('\', '/'); sha256 = $hash; size_bytes = [int64]$length })
        }

        $packageName = "PointBench-Dependencies-$($versions.dependenciesVersion)"
        $generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        $metadata = [ordered]@{
            schema_version = 1
            app_version = $versions.dependenciesVersion
            package_type = 'dependencies'
            package_name = $packageName
            generated_at_utc = $generatedAt
            platform = 'windows-x64'
            architecture = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
            runtime_versions = [ordered]@{
                python = [string]$runtimeManifest.python.version
                node = [string]$runtimeManifest.node.version
                npm = [string]$runtimeManifest.node.npm_version
            }
            source_runtime_manifest = [ordered]@{
                path = 'runtime/runtime-manifest.json'
                sha256 = $runtimeManifestHash
            }
            archive_policy = [ordered]@{
                format = 'exe-installer'
                compression = 'none'
                payload_magic = 'PBPKG001'
            }
            manifest_in_payload = $true
            exclusions = @('dependency-metadata.json is not self-hashed in file_records', 'project source and build outputs')
            file_records = @($records.ToArray())
        }
        $metadataPath = Join-Path $buildRoot 'dependency-metadata.json'
        [IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding $false))
        $dependencyFiles += [pscustomobject]@{ Source = $metadataPath; Relative = 'dependency-metadata.json' }

        $extraFields = [ordered]@{
            SchemaVersion = '2'
            PackageName = $packageName
            GeneratedAtUtc = $generatedAt
            SourceRuntimeManifestSha256 = $runtimeManifestHash
            RuntimeVersions = ($metadata.runtime_versions | ConvertTo-Json -Compress)
        }
        New-RawInstaller -HostPath $hostExe -OutputPath $dependencyOutput -PackageType 'dependencies' -Version $versions.dependenciesVersion -RequiredDependenciesVersion '' -Files $dependencyFiles -ExtraManifestFields $extraFields
    }
}

if ($buildCode) {
    $codeFiles = @(Get-CodeFiles $root)
    foreach ($requiredRelative in @('assets/PointBench.ico', 'backend/app/main.py', 'config/version.json', 'frontend/package.json', 'scripts/launcher.ps1', 'scripts/run.vbs')) {
        if ($requiredRelative -notin $codeFiles.Relative) { throw "Code installer input is missing: $requiredRelative" }
    }
    $launcherPath = Join-Path $root 'scripts\launcher.ps1'
    $launcherBytes = [IO.File]::ReadAllBytes($launcherPath)
    if ($launcherBytes.Length -lt 3 -or $launcherBytes[0] -ne 0xEF -or $launcherBytes[1] -ne 0xBB -or $launcherBytes[2] -ne 0xBF) {
        throw 'scripts/launcher.ps1 must use UTF-8 with BOM for Windows PowerShell 5.1 compatibility.'
    }
    $launcherParseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($launcherPath, [ref]$null, [ref]$launcherParseErrors) | Out-Null
    if ($launcherParseErrors.Count -gt 0) {
        throw "Windows PowerShell launcher syntax check failed: $($launcherParseErrors[0].Message)"
    }

    $records = New-Object System.Collections.Generic.List[object]
    foreach ($file in $codeFiles) {
        $length = (Get-Item -LiteralPath $file.Source).Length
        $hash = Get-Sha256 $file.Source
        $file | Add-Member -NotePropertyName LengthBytes -NotePropertyValue ([int64]$length) -Force
        $file | Add-Member -NotePropertyName Sha256 -NotePropertyValue $hash -Force
        [void]$records.Add([ordered]@{ path = $file.Relative.Replace('\', '/'); sha256 = $hash; size_bytes = [int64]$length })
    }

    $packageName = "PointBench-Code-$($versions.codeVersion)"
    $generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    $manifest = [ordered]@{
        schema_version = 1
        app_version = $versions.codeVersion
        package_type = 'code'
        package_name = $packageName
        package_timestamp_utc = $resolvedTimestamp
        generated_at_utc = $generatedAt
        platform = 'windows-x64'
        required_dependencies_version = $versions.minimumDependenciesVersion
        archive_policy = [ordered]@{
            format = 'exe-installer'
            compression = 'none'
            payload_magic = 'PBPKG001'
        }
        manifest_in_payload = $true
        included = @('assets', 'backend', 'config', 'frontend', 'scripts', 'doc', 'sample_data')
        excluded = @('runtime', 'frontend/node_modules', 'frontend/dist', 'logs', 'storage', 'outputs', 'dist', '.git', '.offline-build', 'backend/.venv', 'code-package-manifest.json is not self-hashed in files')
        files = @($records.ToArray())
    }
    $manifestPath = Join-Path $buildRoot 'code-package-manifest.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding $false))
    $codeFiles += [pscustomobject]@{ Source = $manifestPath; Relative = 'code-package-manifest.json' }

    $extraFields = [ordered]@{
        SchemaVersion = '2'
        PackageName = $packageName
        GeneratedAtUtc = $generatedAt
        RequiredDependenciesVersion = $versions.minimumDependenciesVersion
    }
    New-RawInstaller -HostPath $hostExe -OutputPath $codeOutput -PackageType 'code' -Version $versions.codeVersion -RequiredDependenciesVersion $versions.minimumDependenciesVersion -Files $codeFiles -ExtraManifestFields $extraFields
}

Write-Host ''
Write-Host "[OK] PointBench installer build finished. Package=$Package" -ForegroundColor Green
