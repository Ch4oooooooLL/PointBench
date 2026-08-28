#requires -Version 5.1
<#
.SYNOPSIS
    Build the PointBench EXE installer packages (dependencies + code).

.DESCRIPTION
    Dependency metadata is checked before packaging.  A dependency installer
    EXE is reused only when its embedded metadata matches the current
    application version and the SHA-256 of runtime\runtime-manifest.json.
    The code installer is always rebuilt with a UTC timestamp.

    PointBench does not use archive packages: both artifacts are self-contained
    Windows x64 EXE installers in the PBPKG001 payload format produced by
    scripts\build-installers.ps1.

    An optional ResultPath writes a machine-readable PASS contract containing
    the installers produced by this run.
#>

[CmdletBinding()]
param(
    [string]$RepositoryRoot = '',
    [string]$Timestamp = '',
    [Alias('OutputDir')]
    [string]$OutputRoot = '',
    [string]$ResultPath = '',
    [switch]$ForceDependencies,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [IO.Path]::GetFullPath($Path)
}

function Resolve-RepositoryRoot {
    param([string]$RequestedRoot)
    if ([string]::IsNullOrWhiteSpace($RequestedRoot)) {
        return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..') -ErrorAction Stop).Path
    }
    $resolved = Resolve-Path -LiteralPath $RequestedRoot -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Container)) {
        throw "RepositoryRoot 不是目录：$RequestedRoot"
    }
    return (Get-FullPath $resolved.Path)
}

function Resolve-File {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Description
    )
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
        throw "$Description 不是文件：$Path"
    }
    return (Get-FullPath $resolved.Path)
}

function Get-FileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-VersionJson {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $specPath = Join-Path $Repo 'config\version.json'
    if (-not (Test-Path -LiteralPath $specPath -PathType Leaf)) {
        throw "未找到 config\version.json：$specPath"
    }
    $versions = Get-Content -LiteralPath $specPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($versions.codeVersion)) { throw 'version.json 缺少 codeVersion' }
    if ([string]::IsNullOrWhiteSpace($versions.dependenciesVersion)) { throw 'version.json 缺少 dependenciesVersion' }
    if ([string]::IsNullOrWhiteSpace($versions.minimumDependenciesVersion)) { throw 'version.json 缺少 minimumDependenciesVersion' }
    if ($versions.minimumDependenciesVersion -cne $versions.dependenciesVersion) {
        throw ("minimumDependenciesVersion（{0}）必须等于 dependenciesVersion（{1}）：安装器要求精确匹配。" -f $versions.minimumDependenciesVersion, $versions.dependenciesVersion)
    }
    return $versions
}

function Test-DependencyFilesNewerThanManifest {
    param(
        [Parameter(Mandatory = $true)][string]$Repo,
        [Parameter(Mandatory = $true)][datetime]$ManifestGeneratedAt
    )
    # If any dependency file was modified after the fingerprint manifest was
    # generated, the manifest is stale and a reuse decision would ship the old
    # dependencies.  Returns the newest file timestamp (or $null when the
    # manifest is fresh).
    $latest = $null
    foreach ($scanRoot in @((Join-Path $Repo 'runtime'), (Join-Path $Repo 'frontend\node_modules'))) {
        if (-not (Test-Path -LiteralPath $scanRoot -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $scanRoot -File -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
            # The manifest itself is always written after its generated_at clock
            # reading; it must not count as a stale dependency.
            $relative = $_.FullName.Substring($Repo.Length).TrimStart('\', '/').Replace('\', '/')
            if ($relative -ieq 'runtime/runtime-manifest.json') { return }
            if ($_.LastWriteTimeUtc -gt $ManifestGeneratedAt) {
                if ($null -eq $latest -or $_.LastWriteTimeUtc -gt $latest) { $latest = $_.LastWriteTimeUtc }
            }
        }
    }
    return $latest
}

function Get-RuntimeManifestHash {
    param([Parameter(Mandatory = $true)][string]$Repo)
    $manifest = Join-Path $Repo 'runtime\runtime-manifest.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        throw "未找到运行时指纹清单：$manifest。请先运行 scripts\update-runtime-manifest.ps1 或 scripts\setup-portable-deps.bat。"
    }
    return (Get-FileSha256 $manifest)
}

function Read-InstallerManifest {
    param([Parameter(Mandatory = $true)][string]$InstallerPath)
    # Reads the trailing PBPKG001 manifest of an installer EXE and returns
    # header fields plus the raw manifest bytes.
    $stream = [IO.File]::OpenRead($InstallerPath)
    try {
        $length = $stream.Length
        if ($length -lt 16) { throw '安装包不完整' }
        $stream.Position = $length - 16
        $tail = New-Object byte[] 16
        [void]$stream.Read($tail, 0, 16)
        $manifestLength = [BitConverter]::ToInt64($tail, 0)
        $magic = [Text.Encoding]::ASCII.GetString($tail, 8, 8)
        if ($magic -cne 'PBPKG001') { throw '没有找到 PointBench 安装载荷（PBPKG001）' }
        if ($manifestLength -le 0 -or $manifestLength -gt $length - 16) { throw '安装清单长度无效' }
        $stream.Position = $length - 16 - $manifestLength
        $manifestBytes = New-Object byte[] $manifestLength
        [void]$stream.Read($manifestBytes, 0, [int]$manifestLength)
    }
    finally {
        $stream.Dispose()
    }

    $result = [ordered]@{ RawManifestBytes = $manifestBytes; Headers = [ordered]@{}; Files = @() }
    $text = [Text.Encoding]::UTF8.GetString($manifestBytes)
    foreach ($raw in $text.Split("`n")) {
        $line = $raw.TrimEnd("`r")
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = $line.Split("`t")
        if ($parts.Length -eq 4 -and $parts[0] -eq 'F') {
            $result.Files += [pscustomobject]@{
                Length = [long]$parts[1]
                Sha256 = $parts[2]
                Path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[3]))
            }
        }
        elseif ($parts.Length -eq 2) {
            $result.Headers[$parts[0]] = $parts[1]
        }
    }
    if ([string]::IsNullOrWhiteSpace($result.Headers['Type']) -or $result.Files.Count -eq 0) {
        throw '安装清单缺少必要字段'
    }
    return [pscustomobject]$result
}

function Get-DependencyDecision {
    param(
        [Parameter(Mandatory = $true)][string]$DependencyInstaller,
        [Parameter(Mandatory = $true)][string]$DependenciesVersion,
        [Parameter(Mandatory = $true)][string]$RuntimeManifestHash
    )

    $decision = [ordered]@{
        Reuse = $false
        Reason = 'dependency installer is missing'
        Metadata = $null
    }
    if (-not (Test-Path -LiteralPath $DependencyInstaller -PathType Leaf)) {
        return [pscustomobject]$decision
    }

    try {
        $metadata = Read-InstallerManifest $DependencyInstaller
        $headers = $metadata.Headers
        if ([string]$headers['SchemaVersion'] -cne '2') { throw 'SchemaVersion 不是 2（缺少可复用元数据）' }
        if ([string]$headers['Type'] -cne 'dependencies') { throw 'Type 不是 dependencies' }
        if ([string]$headers['Version'] -cne $DependenciesVersion) { throw 'Version 与 dependenciesVersion 不一致' }
        $expectedName = 'PointBench-Dependencies-' + $DependenciesVersion
        if ([string]$headers['PackageName'] -cne $expectedName) { throw 'PackageName 与预期不一致' }
        $embeddedHash = [string]$headers['SourceRuntimeManifestSha256']
        if ($embeddedHash -notmatch '^[0-9a-fA-F]{64}$') { throw 'SourceRuntimeManifestSha256 无效' }
        if ($embeddedHash.ToLowerInvariant() -cne $RuntimeManifestHash.ToLowerInvariant()) {
            throw '运行时指纹 SHA-256 不匹配（依赖已变化）'
        }
        $decision.Reuse = $true
        $decision.Reason = '依赖元数据与当前运行时指纹匹配'
        $decision.Metadata = $metadata
    }
    catch {
        # Reuse is fail-closed: unreadable, malformed, and mismatched metadata
        # all cause a fresh dependency installer to be built.
        $decision.Reuse = $false
        $decision.Reason = $_.Exception.Message
    }
    return [pscustomobject]$decision
}

function Get-ChildPowerShell {
    $windowsPowerShell = $null
    if (-not [string]::IsNullOrWhiteSpace($env:SystemRoot)) {
        $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    }
    if ($windowsPowerShell -and (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) {
        return (Get-FullPath $windowsPowerShell)
    }
    $command = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
    $command = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
    $command = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
    throw '未找到可用的 PowerShell 子进程'
}

function Convert-InvocationArguments {
    param([hashtable]$Arguments)
    $result = New-Object System.Collections.Generic.List[string]
    foreach ($key in $Arguments.Keys) {
        $value = $Arguments[$key]
        if ($null -eq $value) { continue }
        if ($value -is [System.Management.Automation.SwitchParameter]) {
            if ([bool]$value) { [void]$result.Add('-' + $key) }
            continue
        }
        if ($value -is [bool]) {
            if ($value) { [void]$result.Add('-' + $key) }
            continue
        }
        [void]$result.Add('-' + $key)
        [void]$result.Add([string]$value)
    }
    return $result.ToArray()
}

function Invoke-ChildPowerShellScript {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][hashtable]$Arguments,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $script = Resolve-File $ScriptPath $Label
    $powershell = Get-ChildPowerShell
    $childArguments = New-Object System.Collections.Generic.List[string]
    foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script)) {
        [void]$childArguments.Add($argument)
    }
    foreach ($argument in (Convert-InvocationArguments $Arguments)) {
        [void]$childArguments.Add($argument)
    }
    $output = @(& $powershell $childArguments.ToArray() 2>&1)
    $exitCode = $LASTEXITCODE
    foreach ($line in $output) {
        Write-Output ('[' + $Label + '] ' + [string]$line)
    }
    if ($exitCode -ne 0) {
        $detail = (($output | ForEach-Object { [string]$_ } | Select-Object -Last 8) -join ' | ')
        if ($detail.Length -gt 2000) { $detail = $detail.Substring(0, 2000) }
        if ([string]::IsNullOrWhiteSpace($detail)) {
            throw "$Label 执行失败，退出码：$exitCode"
        }
        throw "$Label 执行失败，退出码：$exitCode；输出：$detail"
    }
    return $output
}

function Assert-ProducedInstaller {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $resolved = Resolve-File $Path $Label
    $item = Get-Item -LiteralPath $resolved -ErrorAction Stop
    if ($item.Length -le 0) { throw "$Label 为空：$resolved" }
    if ($item.Extension -ine '.exe') { throw "$Label 不是 EXE：$resolved" }
    # A produced installer must carry the payload marker.
    $stream = [IO.File]::OpenRead($resolved)
    try {
        if ($stream.Length -lt 16) { throw '安装包不完整' }
        $stream.Position = $stream.Length - 8
        $magic = New-Object byte[] 8
        [void]$stream.Read($magic, 0, 8)
        if ([Text.Encoding]::ASCII.GetString($magic) -cne 'PBPKG001') {
            throw "$Label 缺少 PBPKG001 载荷标记：$resolved"
        }
    }
    finally {
        $stream.Dispose()
    }
    return $resolved
}

function Remove-ExpectedInstaller {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$OutputDirectory
    )
    $target = (Get-FullPath $Path).TrimEnd('\')
    $root = (Get-FullPath $OutputDirectory).TrimEnd('\')
    if (-not $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "安装包路径不在输出目录内：$target"
    }
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        Remove-Item -LiteralPath $target -Force -ErrorAction Stop
    }
}

function Test-InteractiveHost {
    param([switch]$SkipPause)
    if ($SkipPause) { return $false }
    try {
        if (-not [Environment]::UserInteractive) { return $false }
        if ($Host.Name -ne 'ConsoleHost') { return $false }
        if ([Console]::IsInputRedirected) { return $false }
        return $true
    }
    catch {
        return $false
    }
}

function Resolve-ResultPath {
    param(
        [string]$RequestedPath,
        [string]$Repo
    )
    if ([string]::IsNullOrWhiteSpace($RequestedPath)) { return $null }
    $path = $RequestedPath
    if (-not [IO.Path]::IsPathRooted($path)) { $path = Join-Path $Repo $path }
    $full = Get-FullPath $path
    if ([IO.Path]::GetExtension($full) -ine '.json') {
        throw "ResultPath 必须是 .json 文件：$full"
    }
    $parent = Split-Path -Parent $full
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    return $full
}

function Write-ResultContract {
    param(
        [string]$Path,
        [string]$Status,
        [string]$Repo,
        [string]$OutputDirectory,
        [string]$CodeVersion,
        [string]$DependenciesVersion,
        [string]$RunTimestamp,
        [System.Collections.Generic.List[string]]$Artifacts,
        [string]$MetadataDecision,
        [string]$FailureMessage
    )
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    $contract = [ordered]@{
        schema_version = 1
        status = $Status
        repository_root = $Repo
        output_root = $OutputDirectory
        code_version = $CodeVersion
        dependencies_version = $DependenciesVersion
        timestamp = $RunTimestamp
        metadata_decision = $MetadataDecision
        artifacts = @($Artifacts.ToArray())
        error = $FailureMessage
    }
    $contract | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Write-RunSummary {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Summary,
        [Parameter(Mandatory = $true)][datetime]$StartedAt,
        [System.Exception]$Failure
    )
    $Summary.Elapsed = ('{0:N1} 秒' -f ((Get-Date) - $StartedAt).TotalSeconds)
    if ($null -eq $Failure) { $Summary.Status = '成功' }
    else { $Summary.Status = '失败' }
    Write-Output ''
    Write-Output '========== 打包运行摘要 =========='
    Write-Output ('状态：' + $Summary.Status)
    Write-Output ('依赖元数据判定：' + $Summary.MetadataDecision)
    Write-Output ('依赖安装包：' + $Summary.DependencyInstaller)
    Write-Output ('代码安装包：' + $Summary.CodeInstaller)
    Write-Output ('本次产物：' + $Summary.Artifacts)
    Write-Output ('结果文件：' + $Summary.ResultPath)
    Write-Output ('耗时：' + $Summary.Elapsed)
    if ($null -ne $Failure) { Write-Output ('错误：' + $Failure.Message) }
    Write-Output '========================================'
}

$startedAt = Get-Date
$produced = New-Object System.Collections.Generic.List[string]
$summary = [ordered]@{
    Status = '失败'
    MetadataDecision = '未判定'
    DependencyInstaller = '未构建'
    CodeInstaller = '未构建'
    Artifacts = '无'
    ResultPath = if ([string]::IsNullOrWhiteSpace($ResultPath)) { '未指定' } else { $ResultPath }
    Elapsed = '未计时'
}
$failure = $null
$repo = ''
$dist = ''
$codeVersion = ''
$dependenciesVersion = ''
$resolvedResultPath = $null
$runTimestamp = $Timestamp

try {
    $repo = Resolve-RepositoryRoot $RepositoryRoot
    $resolvedResultPath = Resolve-ResultPath $ResultPath $repo
    if ($null -ne $resolvedResultPath) {
        $summary.ResultPath = $resolvedResultPath
        # Remove a previous PASS contract before doing any work so a failed run
        # cannot leave stale success evidence for an automated caller.
        if (Test-Path -LiteralPath $resolvedResultPath -PathType Leaf) {
            Remove-Item -LiteralPath $resolvedResultPath -Force -ErrorAction Stop
        }
    }
    $versions = Read-VersionJson $repo
    $codeVersion = [string]$versions.codeVersion
    $dependenciesVersion = [string]$versions.dependenciesVersion
    if ($codeVersion -notmatch '^[0-9]+(?:\.[0-9]+)*$') { throw "无效的 codeVersion：$codeVersion" }
    if ($dependenciesVersion -notmatch '^[0-9]+(?:\.[0-9]+)*(\.[A-Za-z0-9_-]+)?$') { throw "无效的 dependenciesVersion：$dependenciesVersion" }

    if ([string]::IsNullOrWhiteSpace($runTimestamp)) {
        $runTimestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    }
    if ($runTimestamp -notmatch '^\d{8}T\d{6}Z$') {
        throw "无效的 Timestamp：$runTimestamp"
    }
    $dist = if ([string]::IsNullOrWhiteSpace($OutputRoot)) { Join-Path $repo 'dist' } else { $OutputRoot }
    if (-not [IO.Path]::IsPathRooted($dist)) { $dist = Join-Path $repo $dist }
    $dist = Get-FullPath $dist
    New-Item -ItemType Directory -Force -Path $dist | Out-Null

    $manifestHash = Get-RuntimeManifestHash $repo
    $manifestJson = Get-Content -LiteralPath (Join-Path $repo 'runtime\runtime-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifestGenerated = $null
    if ($manifestJson.generated_at) {
        try { $manifestGenerated = [datetime]::Parse($manifestJson.generated_at, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal) } catch { $manifestGenerated = $null }
    }
    $staleFileTime = if ($null -ne $manifestGenerated) { Test-DependencyFilesNewerThanManifest $repo $manifestGenerated } else { $null }
    if ($null -ne $staleFileTime) {
        Write-Output "[警告] 有依赖文件晚于 runtime-manifest.json 生成时间（$($staleFileTime.ToString('o'))）。清单可能已过期，建议先运行 scripts\update-runtime-manifest.ps1 重新生成指纹。"
    }

    $dependencyName = 'PointBench-Dependencies-' + $dependenciesVersion
    $dependencyInstaller = Join-Path $dist ($dependencyName + '.exe')
    $decision = Get-DependencyDecision $dependencyInstaller $dependenciesVersion $manifestHash
    if ($decision.Reuse -and -not $ForceDependencies) {
        $summary.MetadataDecision = '匹配，复用现有依赖安装包（仅构建代码）'
        $summary.DependencyInstaller = '复用：' + $dependencyInstaller
    }
    else {
        $summary.MetadataDecision = '不匹配或无效，重建依赖安装包（' + $decision.Reason + '）'
        Remove-ExpectedInstaller $dependencyInstaller $dist
        $dependencyArguments = @{
            ProjectDir = $repo
            OutputDir = $dist
            Package = 'Dependencies'
            Timestamp = $runTimestamp
            ForceDependencies = $true
        }
        Invoke-ChildPowerShellScript (Join-Path $repo 'scripts\build-installers.ps1') $dependencyArguments '依赖打包' | Out-Null
        $builtDependency = Assert-ProducedInstaller $dependencyInstaller '依赖安装包'
        [void]$produced.Add($builtDependency)
        $summary.DependencyInstaller = '已构建：' + $builtDependency
    }

    $codeName = 'PointBench-Code-' + $codeVersion
    $codeInstaller = Join-Path $dist ($codeName + '.exe')
    $codeArguments = @{
        ProjectDir = $repo
        OutputDir = $dist
        Package = 'Code'
        Timestamp = $runTimestamp
    }
    Remove-ExpectedInstaller $codeInstaller $dist
    Invoke-ChildPowerShellScript (Join-Path $repo 'scripts\build-installers.ps1') $codeArguments '代码打包' | Out-Null
    $builtCode = Assert-ProducedInstaller $codeInstaller '代码安装包'
    [void]$produced.Add($builtCode)
    $summary.CodeInstaller = '已构建：' + $builtCode

    if ($produced.Count -eq 0) { throw '本次没有生成安装包' }
    $summary.Artifacts = ($produced -join '；')
}
catch {
    $failure = $_.Exception
    if ($summary.Artifacts -eq '无' -and $produced.Count -gt 0) {
        $summary.Artifacts = ($produced -join '；')
    }
}

if ($null -ne $resolvedResultPath) {
    $resultStatus = if ($null -eq $failure) { 'PASS' } else { 'FAIL' }
    $failureMessage = if ($null -eq $failure) { $null } else { $failure.Message }
    try {
        Write-ResultContract $resolvedResultPath $resultStatus $repo $dist $codeVersion $dependenciesVersion $runTimestamp $produced $summary.MetadataDecision $failureMessage
    }
    catch {
        if ($null -eq $failure) { $failure = $_.Exception }
        else { $failure = New-Object System.Exception($failure.Message + '; 结果文件写入失败：' + $_.Exception.Message, $failure) }
    }
}

Write-RunSummary $summary $startedAt $failure
if (Test-InteractiveHost -SkipPause:$NoPause) {
    Read-Host '按 Enter 键结束' | Out-Null
}
if ($null -ne $failure) {
    # Throw after the final summary so a calling PowerShell host can catch the
    # failure and continue running its own commands.
    throw $failure
}
