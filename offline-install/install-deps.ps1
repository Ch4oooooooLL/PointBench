param()

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir '..'))
$InstallerDir = Join-Path $ScriptDir 'installers'
$PipDir = Join-Path $ScriptDir 'pip-packages'
$NodeDir = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
$LogFile = Join-Path $ScriptDir 'install-deps.log'
$PythonInstallerLog = Join-Path $ScriptDir 'python-installer.log'

function Write-Section {
    param([string]$Text)
    Write-Host '========================================'
    Write-Host "  $Text"
    Write-Host '========================================'
    Write-Host ''
}

function Write-Info {
    param([string]$Text)
    Write-Host "  $Text"
}

function Add-ProcessPathEntry {
    param([string]$PathEntry)

    if ([string]::IsNullOrWhiteSpace($PathEntry)) {
        return
    }

    $parts = @($env:PATH -split ';' | Where-Object { $_ })
    if ($parts -notcontains $PathEntry) {
        $env:PATH = "$PathEntry;$env:PATH"
    }
}

function Add-UserPathEntry {
    param([string]$PathEntry)

    if ([string]::IsNullOrWhiteSpace($PathEntry)) {
        return
    }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @($userPath -split ';' | Where-Object { $_ })
    $alreadyPresent = $false
    foreach ($part in $parts) {
        if ([string]::Equals($part.TrimEnd('\'), $PathEntry.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
            $alreadyPresent = $true
            break
        }
    }

    if (-not $alreadyPresent) {
        $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $PathEntry } else { "$userPath;$PathEntry" }
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Write-Info "Added to user PATH: $PathEntry"
    }
}

function Invoke-LoggedCommand {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = $null
    )

    $oldLocation = (Get-Location).Path
    if ($WorkingDirectory) {
        Set-Location $WorkingDirectory
    }

    try {
        $displayArgs = $ArgumentList -join ' '
        Write-Info "> $FilePath $displayArgs"
        & $FilePath @ArgumentList 2>&1 | ForEach-Object {
            Write-Host "  $_"
        }
        return $LASTEXITCODE
    } finally {
        if ($WorkingDirectory) {
            Set-Location $oldLocation
        }
    }
}

function Expand-ZipWithProgress {
    param(
        [Parameter(Mandatory=$true)][string]$ZipPath,
        [Parameter(Mandatory=$true)][string]$DestinationPath,
        [Parameter(Mandatory=$true)][string]$Label
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    if (-not (Test-Path $DestinationPath)) {
        New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
    }

    $destinationRoot = [System.IO.Path]::GetFullPath($DestinationPath).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entries = @($archive.Entries)
        $total = $entries.Count
        if ($total -eq 0) {
            throw "Zip archive is empty: $ZipPath"
        }

        Write-Info "Extracting $Label ($total entries)..."
        for ($i = 0; $i -lt $total; $i++) {
            $entry = $entries[$i]
            $target = [System.IO.Path]::GetFullPath((Join-Path $DestinationPath $entry.FullName))
            if (-not $target.StartsWith($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Unsafe zip entry path: $($entry.FullName)"
            }

            if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\') -or [string]::IsNullOrEmpty($entry.Name)) {
                New-Item -ItemType Directory -Path $target -Force | Out-Null
            } else {
                $parent = Split-Path -Parent $target
                if (-not (Test-Path $parent)) {
                    New-Item -ItemType Directory -Path $parent -Force | Out-Null
                }
                if (Test-Path $target) {
                    Remove-Item $target -Force
                }
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target)
            }

            $done = $i + 1
            if (($done % 500 -eq 0) -or ($done -eq $total)) {
                Write-Info "[$Label] extracted $done/$total"
            }
        }
    } finally {
        $archive.Dispose()
    }
}

function Test-PythonExe {
    param([string]$Candidate)

    if ([string]::IsNullOrWhiteSpace($Candidate) -or -not (Test-Path $Candidate)) {
        return $false
    }

    $version = & $Candidate --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        return $false
    }

    return ("$version" -match '^Python 3\.14\.')
}

function Find-PythonExe {
    param([string]$PreferredTarget)

    $candidates = New-Object System.Collections.Generic.List[string]
    $preferredExe = Join-Path $PreferredTarget 'python.exe'
    $candidates.Add($preferredExe)
    $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314\python.exe'))
    if ($env:ProgramFiles) {
        $candidates.Add((Join-Path $env:ProgramFiles 'Python314\python.exe'))
    }

    $pythonCmd = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        $candidates.Add($pythonCmd.Source)
    }

    $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $launcherResult = & $pyLauncher.Source -3.14 -c 'import sys; print(sys.executable)' 2>$null
        if ($LASTEXITCODE -eq 0 -and $launcherResult) {
            $candidates.Add("$launcherResult")
        }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-PythonExe $candidate) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    return $null
}

function Install-Python {
    $pyInstaller = Join-Path $InstallerDir 'python-installer.exe'
    $pyTarget = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python314'

    Write-Section '[1/4] Installing Python 3.14'
    Write-Info "Installer: $pyInstaller"
    Write-Info "Target:    $pyTarget"
    Write-Info "Log:       $PythonInstallerLog"
    Write-Host ''

    if (Test-Path $PythonInstallerLog) {
        Remove-Item $PythonInstallerLog -Force
    }

    $args = @(
        '/quiet',
        'InstallAllUsers=0',
        "`"TargetDir=$pyTarget`"",
        'PrependPath=1',
        'Include_test=0',
        'Include_pip=1',
        '/log',
        "`"$PythonInstallerLog`""
    )

    $process = Start-Process -FilePath $pyInstaller -ArgumentList $args -PassThru
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not $process.HasExited) {
        Start-Sleep -Seconds 5
        $process.Refresh()
        $logSizeKb = 0
        if (Test-Path $PythonInstallerLog) {
            $logSizeKb = [Math]::Round((Get-Item $PythonInstallerLog).Length / 1KB)
        }
        Write-Info ("[Python] installer running... {0}s elapsed, installer log {1} KB" -f [int]$timer.Elapsed.TotalSeconds, $logSizeKb)
    }
    $process.WaitForExit()

    $exitCode = $process.ExitCode
    Write-Info "Python installer exit code: $exitCode"

    $pythonExe = Find-PythonExe -PreferredTarget $pyTarget
    if (($exitCode -ne 0) -and ($exitCode -ne 3010)) {
        if ($pythonExe) {
            Write-Info "[WARNING] Installer returned $exitCode, but Python 3.14 is usable. Continuing."
        } else {
            throw "Python installation failed (exit code: $exitCode). See $PythonInstallerLog"
        }
    }

    if (-not $pythonExe) {
        throw "Python 3.14 was not found after installation. See $PythonInstallerLog"
    }

    $pythonBase = Split-Path -Parent $pythonExe
    Add-ProcessPathEntry (Join-Path $pythonBase 'Scripts')
    Add-ProcessPathEntry $pythonBase
    Add-UserPathEntry $pythonBase
    Add-UserPathEntry (Join-Path $pythonBase 'Scripts')

    Write-Host ''
    $versionCode = Invoke-LoggedCommand -FilePath $pythonExe -ArgumentList @('--version')
    if ($versionCode -ne 0) {
        throw "Python exists but is not runnable: $pythonExe"
    }
    Write-Info "[OK] Python installed successfully: $pythonExe"
    Write-Host ''

    return $pythonExe
}

function Install-Node {
    Write-Section '[2/4] Installing Node.js 24 LTS'

    if (Test-Path $NodeDir) {
        Write-Info "Found existing $NodeDir, replacing..."
        Remove-Item $NodeDir -Recurse -Force
    }

    $nodeZip = Join-Path $InstallerDir 'nodejs.zip'
    Expand-ZipWithProgress -ZipPath $nodeZip -DestinationPath $NodeDir -Label 'Node.js'

    $nodeBin = $NodeDir
    if (-not (Test-Path (Join-Path $nodeBin 'node.exe'))) {
        $child = Get-ChildItem -Path $NodeDir -Directory -Filter 'node-v*' -ErrorAction SilentlyContinue |
            Where-Object { Test-Path (Join-Path $_.FullName 'node.exe') } |
            Select-Object -First 1
        if ($child) {
            $nodeBin = $child.FullName
        }
    }

    if (-not (Test-Path (Join-Path $nodeBin 'node.exe'))) {
        throw "Node.js executable not found after extraction."
    }

    Add-ProcessPathEntry $nodeBin
    Add-UserPathEntry $nodeBin

    Write-Host ''
    $nodeExe = Join-Path $nodeBin 'node.exe'
    $npmCmd = Join-Path $nodeBin 'npm.cmd'
    if ((Invoke-LoggedCommand -FilePath $nodeExe -ArgumentList @('--version')) -ne 0) {
        throw "Node.js is not runnable: $nodeExe"
    }
    if ((Invoke-LoggedCommand -FilePath $npmCmd -ArgumentList @('--version')) -ne 0) {
        throw "npm is not runnable: $npmCmd"
    }
    Write-Info "[OK] Node.js installed successfully: $nodeBin"
    Write-Host ''

    return $nodeBin
}

function Install-PythonDeps {
    param([string]$PythonExe)

    Write-Section '[3/4] Installing Python project deps'
    Write-Info 'Installing from offline packages (pip install --no-index)...'
    Write-Info 'pip output is streamed below and saved to install-deps.log.'
    Write-Host ''

    $requirements = Join-Path $ProjectDir 'backend\requirements.txt'
    $pipArgs = @(
        '-m',
        'pip',
        'install',
        '--no-index',
        "--find-links=$PipDir",
        '-r',
        $requirements
    )
    $pipExit = Invoke-LoggedCommand -FilePath $PythonExe -ArgumentList $pipArgs

    if ($pipExit -ne 0) {
        Write-Host ''
        Write-Host '  ========================================'
        Write-Host '  NOTE: Some packages failed to install'
        Write-Host '  ========================================'
        Write-Host ''
        Write-Host '  If dwdatareader failed, this can be normal.'
        Write-Host '  It requires the DWDataReaderLib native C++ library,'
        Write-Host '  which must be downloaded from www.dewesoft.com separately.'
        Write-Host ''
        Write-Host '  CSV / TXT / Excel imports are NOT affected.'
        Write-Host ''
    } else {
        Write-Host ''
        Write-Info '[OK] All Python packages installed successfully'
    }
    Write-Host ''
}

function Install-NodeDeps {
    Write-Section '[4/4] Installing Node.js project deps'

    $frontendDir = Join-Path $ProjectDir 'frontend'
    $nodeModules = Join-Path $frontendDir 'node_modules'
    if (Test-Path $nodeModules) {
        Write-Info 'Found existing frontend\node_modules, replacing...'
        Remove-Item $nodeModules -Recurse -Force
    }

    $nodeModulesZip = Join-Path $ScriptDir 'node-modules.zip'
    Expand-ZipWithProgress -ZipPath $nodeModulesZip -DestinationPath $frontendDir -Label 'node_modules'
    Write-Info '[OK] node_modules extracted'
    Write-Host ''
}

function Test-Import {
    param(
        [string]$PythonExe,
        [string]$ModuleName,
        [string]$DisplayName
    )

    & $PythonExe -c "import $ModuleName" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host ("    {0,-17} OK" -f $DisplayName)
    } else {
        Write-Host ("    {0,-17} FAIL" -f $DisplayName)
    }
}

function Verify-Install {
    param(
        [string]$PythonExe,
        [string]$NodeBin
    )

    Write-Section 'Verifying installation'

    Write-Host '  Python environment:'
    Write-Host '  ----------------------------------------'
    & $PythonExe --version >$null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host '    Python ........... OK'
    } else {
        Write-Host '    Python ........... FAIL'
    }
    Test-Import -PythonExe $PythonExe -ModuleName 'fastapi' -DisplayName 'fastapi'
    Test-Import -PythonExe $PythonExe -ModuleName 'sqlalchemy' -DisplayName 'sqlalchemy'
    Test-Import -PythonExe $PythonExe -ModuleName 'pydantic' -DisplayName 'pydantic'
    Test-Import -PythonExe $PythonExe -ModuleName 'openpyxl' -DisplayName 'openpyxl'
    Test-Import -PythonExe $PythonExe -ModuleName 'uvicorn' -DisplayName 'uvicorn'

    Write-Host ''
    Write-Host '  Node.js environment:'
    Write-Host '  ----------------------------------------'
    $nodeExe = Join-Path $NodeBin 'node.exe'
    $npmCmd = Join-Path $NodeBin 'npm.cmd'
    & $nodeExe --version >$null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host '    Node.js ......... OK'
    } else {
        Write-Host '    Node.js ......... FAIL'
    }
    & $npmCmd --version >$null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host '    npm .............. OK'
    } else {
        Write-Host '    npm .............. FAIL'
    }
    if (Test-Path (Join-Path $ProjectDir 'frontend\node_modules')) {
        Write-Host '    node_modules ..... OK'
    } else {
        Write-Host '    node_modules ..... FAIL'
    }
    Write-Host ''
}

function Assert-OfflinePackage {
    Write-Host '[Check] Verifying offline package...'
    Write-Host ''

    $missing = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path (Join-Path $InstallerDir 'python-installer.exe'))) {
        $missing.Add('installers\python-installer.exe')
    }
    if (-not (Test-Path (Join-Path $InstallerDir 'nodejs.zip'))) {
        $missing.Add('installers\nodejs.zip')
    }
    if (-not (Test-Path $PipDir)) {
        $missing.Add('pip-packages\')
    }
    if (-not (Test-Path (Join-Path $ScriptDir 'node-modules.zip'))) {
        $missing.Add('node-modules.zip')
    }

    if ($missing.Count -gt 0) {
        foreach ($item in $missing) {
            Write-Host "  [MISSING] $item"
        }
        Write-Host ''
        throw "Offline package is incomplete. Run download-deps.bat on a PC with internet, then copy the entire offline-install folder."
    }

    Write-Info '[OK] All offline packages present'
    Write-Host ''
}

$exitCode = 0

if (Test-Path $LogFile) {
    Remove-Item $LogFile -Force
}

Start-Transcript -Path $LogFile -Force | Out-Null
try {
    Write-Section 'Offline Dependency Installer'
    Write-Host '  Project: test-point-web'
    Write-Host "  Log:     $LogFile"
    Write-Host ''
    Write-Host '  This script will install:'
    Write-Host '    - Python 3.14'
    Write-Host '    - Node.js 24 LTS'
    Write-Host '    - Python project dependencies'
    Write-Host '    - Node.js project dependencies'
    Write-Host ''
    Write-Host '  No internet. No admin rights required.'
    Write-Host ''

    Assert-OfflinePackage
    $pythonExe = Install-Python
    $nodeBin = Install-Node
    Install-PythonDeps -PythonExe $pythonExe
    Install-NodeDeps
    Verify-Install -PythonExe $pythonExe -NodeBin $nodeBin

    Write-Section 'Installation complete!'
    Write-Host '  How to start the project:'
    Write-Host ''
    Write-Host '   [1] Start backend (open a new terminal):'
    Write-Host "      cd /d `"$ProjectDir\backend`""
    Write-Host '      python -m uvicorn app.main:app --host 0.0.0.0 --port 8000'
    Write-Host ''
    Write-Host '   [2] Start frontend (open another terminal):'
    Write-Host "      cd /d `"$ProjectDir\frontend`""
    Write-Host '      npm run dev'
    Write-Host ''
    Write-Host '   [3] Open browser:'
    Write-Host '      http://localhost:5173'
    Write-Host ''
    Write-Host '  If python or node is not found in a new terminal, restart your PC to refresh PATH.'
    Write-Host ''
    Write-Host "  Full install log: $LogFile"
    Write-Host "  Python installer log: $PythonInstallerLog"
} catch {
    $exitCode = 1
    Write-Host ''
    Write-Host '========================================'
    Write-Host '  Installation failed'
    Write-Host '========================================'
    Write-Host ''
    Write-Host "  [ERROR] $($_.Exception.Message)"
    Write-Host ''
    Write-Host "  Full install log: $LogFile"
    Write-Host "  Python installer log: $PythonInstallerLog"
} finally {
    Stop-Transcript | Out-Null
}

exit $exitCode
