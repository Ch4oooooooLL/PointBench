param(
    [string]$ProjectDir,
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($ProjectDir)) { $ProjectDir = Join-Path $scriptDir '..' }
if ([string]::IsNullOrWhiteSpace($OutputDir)) { $OutputDir = Join-Path $ProjectDir 'dist' }

Write-Host '========================================'
Write-Host '  Build PointBench EXE installers'
Write-Host '========================================'
Write-Host 'Output is split into:'
Write-Host '  1. PointBench Dependencies installer EXE'
Write-Host '  2. PointBench Code installer EXE'
Write-Host ''

& (Join-Path $scriptDir 'build-installers.ps1') -ProjectDir $ProjectDir -OutputDir $OutputDir

Write-Host ''
Write-Host '[OK] Both EXE installers are ready.' -ForegroundColor Green
Write-Host 'Install Dependencies first, then install Code. Administrator privileges are not required.'
