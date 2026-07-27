param(
    [string]$ProjectDir,
    [string]$PythonVersion = '3.12.10',
    [string]$NodeVersion = 'v24.13.1'
)

$ErrorActionPreference = 'Stop'

function Resolve-FullPath([string]$Path) {
    [System.IO.Path]::GetFullPath($Path.TrimEnd('\', '/', '"', ' '))
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
        }
    } finally {
        Pop-Location
    }
}

if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    $ProjectDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..'
}
$root = Resolve-FullPath $ProjectDir
$runtimeDir = Join-Path $root 'runtime'
$pythonDir = Join-Path $runtimeDir 'python'
$nodeDir = Join-Path $runtimeDir 'node'
$frontendDir = Join-Path $root 'frontend'
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("pointbench-deps-" + [guid]::NewGuid().ToString('N'))

$pythonArchive = Join-Path $tempDir 'python-embed.download'
$nodeArchive = Join-Path $tempDir 'node.download'
$pythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$nodeUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"

Write-Host '========================================'
Write-Host '  Setup PointBench portable dependencies'
Write-Host '========================================'
Write-Host "Project: $root"
Write-Host "Python:  $PythonVersion"
Write-Host "Node.js: $NodeVersion"
Write-Host ''

try {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    if (Test-Path -LiteralPath $runtimeDir) {
        Remove-Item -LiteralPath $runtimeDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $pythonDir -Force | Out-Null

    Write-Host '[1/5] Downloading and expanding portable Python...'
    Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonArchive -UseBasicParsing
    Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonDir -Force

    # Embeddable Python normally imports its standard library directly from
    # python3xx.zip. Expand it so the deployed runtime never uses an archive.
    $stdlibArchive = Get-ChildItem -LiteralPath $pythonDir -Filter 'python*.zip' -File | Select-Object -First 1
    if (-not $stdlibArchive) {
        throw 'The embeddable Python standard-library archive was not found.'
    }
    $libDir = Join-Path $pythonDir 'Lib'
    New-Item -ItemType Directory -Path $libDir -Force | Out-Null
    Expand-Archive -LiteralPath $stdlibArchive.FullName -DestinationPath $libDir -Force
    Remove-Item -LiteralPath $stdlibArchive.FullName -Force
    New-Item -ItemType Directory -Path (Join-Path $libDir 'site-packages') -Force | Out-Null

    $pthFile = Get-ChildItem -LiteralPath $pythonDir -Filter 'python*._pth' -File | Select-Object -First 1
    if (-not $pthFile) {
        throw 'The embeddable Python ._pth file was not found.'
    }
    $pthLines = Get-Content -LiteralPath $pthFile.FullName
    $updatedPth = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $pthLines) {
        if ($line.Trim() -match '^python\d+\.zip$') {
            if (-not $updatedPth.Contains('Lib')) { $updatedPth.Add('Lib') }
            continue
        }
        if ($line.Trim() -eq '#import site') { $line = 'import site' }
        $updatedPth.Add($line)
    }
    if (-not $updatedPth.Contains('Lib')) { $updatedPth.Add('Lib') }
    if (-not $updatedPth.Contains('Lib\site-packages')) { $updatedPth.Add('Lib\site-packages') }
    if (-not $updatedPth.Contains('import site')) { $updatedPth.Add('import site') }
    [System.IO.File]::WriteAllLines($pthFile.FullName, $updatedPth, [System.Text.Encoding]::ASCII)

    Write-Host '[2/5] Installing backend packages as unpacked files...'
    $getPipPath = Join-Path $tempDir 'get-pip.py'
    Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPipPath -UseBasicParsing
    Invoke-Checked -FilePath (Join-Path $pythonDir 'python.exe') -Arguments @(
        $getPipPath, '--disable-pip-version-check', '--no-warn-script-location'
    ) -WorkingDirectory $root
    Invoke-Checked -FilePath (Join-Path $pythonDir 'python.exe') -Arguments @(
        '-m', 'pip', 'install',
        '--disable-pip-version-check', '--no-cache-dir', '--only-binary=:all:',
        '-r', (Join-Path $root 'backend\requirements.txt')
    ) -WorkingDirectory $root

    Write-Host '[3/5] Downloading and expanding portable Node.js...'
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeArchive -UseBasicParsing
    $nodeExtractDir = Join-Path $tempDir 'node-expanded'
    Expand-Archive -LiteralPath $nodeArchive -DestinationPath $nodeExtractDir -Force
    $nodeSource = Get-ChildItem -LiteralPath $nodeExtractDir -Directory -Filter 'node-v*' | Select-Object -First 1
    if (-not $nodeSource) { throw 'The downloaded Node.js distribution is invalid.' }
    New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
    Copy-Item -Path (Join-Path $nodeSource.FullName '*') -Destination $nodeDir -Recurse -Force

    Write-Host '[4/5] Installing frontend packages as unpacked files...'
    $previousPath = $env:PATH
    try {
        $env:PATH = "$nodeDir;$previousPath"
        Invoke-Checked -FilePath (Join-Path $nodeDir 'npm.cmd') -Arguments @(
            'ci', '--no-audit', '--no-fund'
        ) -WorkingDirectory $frontendDir
    } finally {
        $env:PATH = $previousPath
    }

    Write-Host '[5/5] Removing caches and verifying the portable dependencies...'
    $sitePackagesDir = Join-Path $libDir 'site-packages'
    Get-ChildItem -LiteralPath $sitePackagesDir, (Join-Path $frontendDir 'node_modules') -Directory -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('__pycache__', '.cache') } |
        Sort-Object FullName -Descending |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $sitePackagesDir, (Join-Path $frontendDir 'node_modules') -File -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @('.pyc', '.pyo') } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    # Some wheels bundle compressed test fixtures and python-dateutil bundles
    # a legacy timezone tarball. PointBench does not use those resources; remove
    # them so the deployed dependency tree contains no files that endpoint
    # encryption software could treat as archives.
    Get-ChildItem -LiteralPath $sitePackagesDir -Directory -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('tests', 'test') } |
        Sort-Object FullName -Descending |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    $legacyDateutilArchive = Join-Path $libDir 'site-packages\dateutil\zoneinfo\dateutil-zoneinfo.tar.gz'
    if (Test-Path -LiteralPath $legacyDateutilArchive) {
        Remove-Item -LiteralPath $legacyDateutilArchive -Force
    }

    $archivePatterns = @('*.zip', '*.whl', '*.7z', '*.rar', '*.tar', '*.tgz', '*.gz', '*.xz', '*.bz2')
    $archives = @(Get-ChildItem -LiteralPath $runtimeDir, (Join-Path $frontendDir 'node_modules') -File -Recurse -Force |
        Where-Object { $name = $_.Name; @($archivePatterns | Where-Object { $name -like $_ }).Count -gt 0 })
    if ($archives.Count -gt 0) {
        $archives | ForEach-Object { Write-Host "  Forbidden archive: $($_.FullName)" }
        throw 'Portable dependencies contain compressed archive files.'
    }

    Invoke-Checked -FilePath (Join-Path $pythonDir 'python.exe') -Arguments @(
        '-c', 'import fastapi,uvicorn,sqlalchemy,alembic,jose,pandas,numpy,openpyxl;print(1)'
    ) -WorkingDirectory (Join-Path $root 'backend')
    Invoke-Checked -FilePath (Join-Path $nodeDir 'node.exe') -Arguments @(
        (Join-Path $frontendDir 'node_modules\vite\bin\vite.js'), '--version'
    ) -WorkingDirectory $frontendDir

    Write-Host ''
    Write-Host '[OK] Portable dependencies installed as ordinary, unpacked files.' -ForegroundColor Green
    Write-Host "     $runtimeDir"
    Write-Host "     $(Join-Path $frontendDir 'node_modules')"
} finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
