param(
    [string]$ProjectDir,
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($ProjectDir)) { $ProjectDir = Join-Path $scriptDir '..' }
if ([string]::IsNullOrWhiteSpace($OutputDir)) { $OutputDir = Join-Path $ProjectDir 'dist' }

Write-Host '========================================'
Write-Host '  Pack PointBench release'
Write-Host '========================================'
Write-Host 'Output is split into:'
Write-Host '  1. A source-code ZIP without dependencies'
Write-Host '  2. An uncompressed dependency directory'
Write-Host ''

& (Join-Path $scriptDir 'pack-code.ps1') -ProjectDir $ProjectDir -OutputDir $OutputDir

& (Join-Path $scriptDir 'pack-dependencies.ps1') -ProjectDir $ProjectDir -OutputDir $OutputDir

Write-Host ''
Write-Host '[OK] Both release artifacts are ready.' -ForegroundColor Green
Write-Host 'Extract the code ZIP, then copy the CONTENTS of the dependency directory into the code directory.'
