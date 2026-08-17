param(
    [Parameter(Mandatory=$false)]
    [string]$ProjectDir,

    [Parameter(Mandatory=$false)]
    [string]$DependencyDir,

    [switch]$ShowLogs
)

$ErrorActionPreference = 'Stop'

$scriptPath = $MyInvocation.MyCommand.Path
$scriptDir = Split-Path -Parent $scriptPath
if ([string]::IsNullOrWhiteSpace($ProjectDir)) {
    $ProjectDir = Join-Path $scriptDir '..'
}
$root = [System.IO.Path]::GetFullPath($ProjectDir.TrimEnd('\', '/', '"', ' '))
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$appUrl = 'http://127.0.0.1:5173/'
$healthUrl = 'http://127.0.0.1:8000/api/health'
$registryInstallState = $null
try {
    $registryInstallState = Get-ItemProperty -LiteralPath 'HKCU:\Software\PointBench' -ErrorAction Stop
} catch {
    $registryInstallState = $null
}

if ([string]::IsNullOrWhiteSpace($DependencyDir)) {
    $localRuntime = Join-Path $root 'runtime\python\python.exe'
    if (Test-Path -LiteralPath $localRuntime -PathType Leaf) {
        $DependencyDir = $root
    } else {
        $DependencyDir = if ($registryInstallState) { [string]$registryInstallState.DependenciesInstallDir } else { '' }
    }
}
if (-not [string]::IsNullOrWhiteSpace($DependencyDir)) {
    $DependencyDir = [System.IO.Path]::GetFullPath($DependencyDir.TrimEnd('\', '/', '"', ' '))
}
$dependencyRuntimeDir = if ($DependencyDir) { Join-Path $DependencyDir 'runtime' } else { '' }
$dependencyNodeModules = if ($DependencyDir) { Join-Path $DependencyDir 'frontend\node_modules' } else { '' }
$userDataDir = ''
if ($registryInstallState -and [string]$registryInstallState.CodeInstallDir -and
    ([System.IO.Path]::GetFullPath([string]$registryInstallState.CodeInstallDir) -eq $root)) {
    $userDataDir = [string]$registryInstallState.UserDataDir
}
$logRoot = if ($userDataDir) { Join-Path $userDataDir 'logs' } else { Join-Path $root 'logs' }
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $logRoot $runId
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$launcherLog = Join-Path $logDir 'launcher.log'
$backendLog = Join-Path $logDir 'backend.log'
$frontendLog = Join-Path $logDir 'frontend.log'
$errorLog = Join-Path $logDir 'errors.log'
$preflightReport = Join-Path $logDir 'preflight-report.txt'
$latestLogDirFile = Join-Path $logRoot 'latest-run.txt'

$script:TextEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false

function ConvertTo-LogText {
    param([object]$Value)

    if ($null -eq $Value) {
        return ''
    }
    if ($Value -is [array]) {
        return (($Value | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
    }
    return [string]$Value
}

function Set-TextFile {
    param(
        [string]$Path,
        [object]$Value
    )

    [System.IO.File]::WriteAllText($Path, (ConvertTo-LogText $Value) + [Environment]::NewLine, $script:TextEncoding)
}

function Add-TextLine {
    param(
        [string]$Path,
        [object]$Value
    )

    [System.IO.File]::AppendAllText($Path, (ConvertTo-LogText $Value) + [Environment]::NewLine, $script:TextEncoding)
}

Set-TextFile -Path $latestLogDirFile -Value $logDir
Set-TextFile -Path $launcherLog -Value ("[{0}] Starting launcher. ShowLogs={1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $ShowLogs)
Set-TextFile -Path $backendLog -Value ("[{0}] Backend log started." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Set-TextFile -Path $frontendLog -Value ("[{0}] Frontend log started." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Set-TextFile -Path $errorLog -Value ("[{0}] Error log started." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

$logOffsets = @{}

function Write-LauncherLog {
    param([string]$Text)
    Add-TextLine -Path $launcherLog -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text)
}

function Write-ExceptionLog {
    param(
        [string]$Title,
        [object]$Record,
        [string]$Path = $launcherLog
    )

    Add-TextLine -Path $Path -Value ''
    Add-TextLine -Path $Path -Value ("===== {0} =====" -f $Title)
    Add-TextLine -Path $Path -Value ("time={0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

    if ($null -eq $Record) {
        Add-TextLine -Path $Path -Value 'message=<null error record>'
        return
    }

    $exception = $Record.Exception
    if ($exception) {
        Add-TextLine -Path $Path -Value ("exception_type={0}" -f $exception.GetType().FullName)
        Add-TextLine -Path $Path -Value ("message={0}" -f $exception.Message)
    } else {
        Add-TextLine -Path $Path -Value ("message={0}" -f $Record.ToString())
    }
    if ($Record.ScriptStackTrace) {
        Add-TextLine -Path $Path -Value ("script_stack_trace={0}" -f $Record.ScriptStackTrace)
    }
    if ($Record.InvocationInfo) {
        Add-TextLine -Path $Path -Value ("position={0}" -f $Record.InvocationInfo.PositionMessage)
    }
    if ($exception -and $exception.StackTrace) {
        Add-TextLine -Path $Path -Value 'exception_stack_trace='
        Add-TextLine -Path $Path -Value $exception.StackTrace
    }
}

function Write-Console {
    param([string]$Text)
    if ($ShowLogs) {
        Write-Host $Text
    }
}

function Test-PointBenchReady {
    try {
        $health = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        if ($health.StatusCode -lt 200 -or $health.StatusCode -ge 400) { return $false }
        $frontend = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 2
        return $frontend.StatusCode -ge 200 -and $frontend.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Open-PointBenchBrowser {
    try {
        Start-Process $appUrl
        Write-LauncherLog "Opened browser: $appUrl"
    } catch {
        Write-ExceptionLog -Title 'open_browser_failed' -Record $_ -Path $launcherLog
        Write-LauncherLog "Failed to open browser automatically: $($_.Exception.Message)"
    }
}

function Write-NewLogLines {
    param(
        [string]$Prefix,
        [string]$Path
    )

    if (-not $ShowLogs -or -not (Test-Path $Path)) {
        return
    }

    $lines = @(Get-Content -Path $Path -ErrorAction SilentlyContinue)
    $offset = 0
    if ($logOffsets.ContainsKey($Path)) {
        $offset = [int]$logOffsets[$Path]
    }

    if ($lines.Count -gt $offset) {
        for ($i = $offset; $i -lt $lines.Count; $i++) {
            Write-Host "[$Prefix] $($lines[$i])"
        }
        $logOffsets[$Path] = $lines.Count
    }
}

function Write-AllNewLogs {
    Write-NewLogLines -Prefix 'backend' -Path $backendLog
    Write-NewLogLines -Prefix 'frontend' -Path $frontendLog
    Write-NewLogLines -Prefix 'errors' -Path $errorLog
}

function Write-LogTail {
    param(
        [string]$Title,
        [string]$Path,
        [int]$Tail = 100
    )

    Write-LauncherLog "===== $Title tail: $Path ====="
    if (-not (Test-Path $Path)) {
        Write-LauncherLog "$Title log is missing."
        Write-Console "[$Title] log is missing: $Path"
        return
    }

    $lines = @(Get-Content -Path $Path -Tail $Tail -ErrorAction SilentlyContinue)
    foreach ($line in $lines) {
        Write-LauncherLog "$Title> $line"
    }
    if ($ShowLogs) {
        Write-Host ''
        Write-Host "===== $Title log tail ====="
        foreach ($line in $lines) {
            Write-Host $line
        }
    }
}

function Write-FailureSummary {
    param([string]$Reason)

    Write-LauncherLog "Startup failure: $Reason"
    Write-LogTail -Title 'errors' -Path $errorLog
    Write-LogTail -Title 'backend' -Path $backendLog
    Write-LogTail -Title 'frontend' -Path $frontendLog
    Write-Console ''
    Write-Console "Startup failure: $Reason"
    Write-Console "Launcher log: $launcherLog"
    Write-Console "Error log:    $errorLog"
    Write-Console "Backend log:  $backendLog"
    Write-Console "Frontend log: $frontendLog"
}

function Invoke-DiagnosticCommand {
    param(
        [string]$Name,
        [string]$FilePath,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [string]$LogPath,
        [switch]$Required
    )

    Add-TextLine -Path $LogPath -Value ''
    Add-TextLine -Path $LogPath -Value ("===== diagnostic: {0} =====" -f $Name)
    Add-TextLine -Path $LogPath -Value ("cwd={0}" -f $WorkingDirectory)
    Add-TextLine -Path $LogPath -Value ("> {0} {1}" -f $FilePath, $Arguments)
    Write-LauncherLog "Diagnostic started: $Name"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    try {
        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $stdout = $proc.StandardOutput.ReadToEnd()
        $stderr = $proc.StandardError.ReadToEnd()
        $proc.WaitForExit()

        if ($stdout) {
            Add-TextLine -Path $LogPath -Value $stdout
        }
        if ($stderr) {
            Add-TextLine -Path $LogPath -Value $stderr
        }
        Add-TextLine -Path $LogPath -Value ("exit_code={0}" -f $proc.ExitCode)
        Write-LauncherLog "Diagnostic finished: $Name ExitCode=$($proc.ExitCode)"

        if ($Required -and $proc.ExitCode -ne 0) {
            throw "Diagnostic failed: $Name. See $LogPath"
        }
    } catch {
        Add-TextLine -Path $LogPath -Value ("diagnostic_exception={0}" -f $_.Exception.Message)
        Write-ExceptionLog -Title "diagnostic_exception: $Name" -Record $_ -Path $LogPath
        Write-LauncherLog "Diagnostic exception: $Name $($_.Exception.Message)"
        if ($Required) {
            throw
        }
    }
}

function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)

    if ($Process -and -not $Process.HasExited) {
        try {
            & taskkill /PID $($Process.Id) /T /F 2>$null
        } catch {
            Write-LauncherLog ("Failed to stop process tree PID={0}: {1}" -f $Process.Id, $_.Exception.Message)
        }
    }
}

function Start-CmdScript {
    param(
        [string]$Name,
        [string]$ScriptPath,
        [string]$WorkingDirectory
    )

    Write-LauncherLog "Starting $Name with script: $ScriptPath"
    $proc = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList @('/d', '/s', '/c', "`"$ScriptPath`"") `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -PassThru
    Write-LauncherLog "$Name started. PID=$($proc.Id)"
    return $proc
}

function Wait-UntilProcessExit {
    param(
        [System.Diagnostics.Process]$BackendProcess,
        [System.Diagnostics.Process]$FrontendProcess
    )

    while (-not $BackendProcess.HasExited -and -not $FrontendProcess.HasExited) {
        Write-AllNewLogs
        Start-Sleep -Seconds 1
    }
    Write-AllNewLogs
    $backendExit = if ($BackendProcess.HasExited) { $BackendProcess.ExitCode } else { 'running' }
    $frontendExit = if ($FrontendProcess.HasExited) { $FrontendProcess.ExitCode } else { 'running' }
    Write-FailureSummary "Process exited. Backend=$backendExit Frontend=$frontendExit"
    Stop-ProcessTree $BackendProcess
    Stop-ProcessTree $FrontendProcess
    exit 1
}

function Wait-HttpReady {
    param(
        [string]$Name,
        [string]$Url,
        [System.Diagnostics.Process]$BackendProcess,
        [System.Diagnostics.Process]$FrontendProcess,
        [int]$TimeoutSeconds = 30
    )

    Write-LauncherLog ("Waiting for {0}: {1}" -f $Name, $Url)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    while ((Get-Date) -lt $deadline) {
        Write-AllNewLogs

        if ($BackendProcess -and $BackendProcess.HasExited) {
            Write-AllNewLogs
            Write-FailureSummary "Backend exited while waiting for $Name. ExitCode=$($BackendProcess.ExitCode)"
            return $false
        }
        if ($FrontendProcess -and $FrontendProcess.HasExited) {
            Write-AllNewLogs
            Write-FailureSummary "Frontend exited while waiting for $Name. ExitCode=$($FrontendProcess.ExitCode)"
            return $false
        }

        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-LauncherLog "$Name is ready. StatusCode=$($response.StatusCode)"
                return $true
            }
            $lastError = "HTTP $($response.StatusCode)"
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 1
    }

    Write-FailureSummary "$Name did not become ready within ${TimeoutSeconds}s. LastError=$lastError"
    return $false
}

function Run-Preflight {
    Write-LauncherLog "Project root: $root"
    Write-LauncherLog "Launcher script path: $scriptPath"
    Write-LauncherLog "Current working directory: $(Get-Location)"
    Write-LauncherLog "Log directory: $logDir"
    Write-LauncherLog "Error log: $errorLog"
    Write-LauncherLog "Preflight report: $preflightReport"
    Write-LauncherLog "PowerShell: $($PSVersionTable.PSVersion)"
    Write-LauncherLog "PATH: $env:PATH"
    Write-LauncherLog "PYTHONPATH: $env:PYTHONPATH"
    Write-LauncherLog "Python executable: $pythonExe"
    Write-LauncherLog "Node executable: $nodeExe"
    Write-LauncherLog "npm executable: $npmExe"
    Write-LauncherLog "Backend dir: $backendDir Exists=$(Test-Path $backendDir)"
    Write-LauncherLog "Backend app dir: $(Join-Path $backendDir 'app') Exists=$(Test-Path (Join-Path $backendDir 'app'))"
    Write-LauncherLog "Backend app __init__.py: $(Join-Path $backendDir 'app\__init__.py') Exists=$(Test-Path (Join-Path $backendDir 'app\__init__.py'))"
    Write-LauncherLog "Backend app database.py: $(Join-Path $backendDir 'app\database.py') Exists=$(Test-Path (Join-Path $backendDir 'app\database.py'))"
    Write-LauncherLog "Frontend dir: $frontendDir Exists=$(Test-Path $frontendDir)"
    Write-LauncherLog "Vite entry: $(Join-Path $frontendDir 'node_modules\vite\bin\vite.js') Exists=$(Test-Path (Join-Path $frontendDir 'node_modules\vite\bin\vite.js'))"

    Invoke-DiagnosticCommand -Name 'python-version' `
        -FilePath $pythonExe `
        -Arguments '--version' `
        -WorkingDirectory $backendDir `
        -LogPath $backendLog `
        -Required

    Invoke-DiagnosticCommand -Name 'pointbench-preflight' `
        -FilePath $pythonExe `
        -Arguments ('"{0}" --project-root "{1}" --python "{2}" --report "{3}"' -f (Join-Path $root 'scripts\preflight_check.py'), $root, $pythonExe, $preflightReport) `
        -WorkingDirectory $root `
        -LogPath $launcherLog `
        -Required

    Invoke-DiagnosticCommand -Name 'backend-import-check' `
        -FilePath $pythonExe `
        -Arguments ('-c "import sys; sys.path.insert(0, r''{0}''); print(sys.executable); import fastapi, uvicorn, sqlalchemy, alembic, jose; import app.main; print(''backend import ok'')"' -f $backendDir) `
        -WorkingDirectory $backendDir `
        -LogPath $backendLog `
        -Required

    Invoke-DiagnosticCommand -Name 'node-version' `
        -FilePath $nodeExe `
        -Arguments '--version' `
        -WorkingDirectory $frontendDir `
        -LogPath $frontendLog `
        -Required

    if ($npmExe) {
        Invoke-DiagnosticCommand -Name 'npm-version' `
            -FilePath $npmExe `
            -Arguments '--version' `
            -WorkingDirectory $frontendDir `
            -LogPath $frontendLog
    } else {
        Add-TextLine -Path $frontendLog -Value ''
        Add-TextLine -Path $frontendLog -Value '===== diagnostic: npm-version ====='
        Add-TextLine -Path $frontendLog -Value 'portable npm was not found; startup does not require npm'
        Write-LauncherLog 'Portable npm was not found; startup does not require npm.'
    }

    Invoke-DiagnosticCommand -Name 'frontend-package-check' `
        -FilePath $nodeExe `
        -Arguments '-e "for (const p of [''vite'',''@vitejs/plugin-react'',''react'',''react-dom'']) require.resolve(p, { paths: [process.cwd()] }); console.log(''frontend packages ok'')"' `
        -WorkingDirectory $frontendDir `
        -LogPath $frontendLog `
        -Required

    Invoke-DiagnosticCommand -Name 'vite-direct-check' `
        -FilePath $nodeExe `
        -Arguments '.\node_modules\vite\bin\vite.js --version' `
        -WorkingDirectory $frontendDir `
        -LogPath $frontendLog `
        -Required
}

try {
    if (Test-PointBenchReady) {
        Write-LauncherLog 'PointBench is already running; opening the existing instance.'
        Open-PointBenchBrowser
        exit 0
    }

    $launcherMutex = [System.Threading.Mutex]::new($false, 'Local\PointBenchLauncher')
    if (-not $launcherMutex.WaitOne(0, $false)) {
        Write-LauncherLog 'Another launcher is starting PointBench; waiting for it to become ready.'
        for ($attempt = 0; $attempt -lt 35; $attempt++) {
            Start-Sleep -Seconds 1
            if (Test-PointBenchReady) {
                Open-PointBenchBrowser
                exit 0
            }
        }
        throw 'Another PointBench launcher is active, but the application did not become ready within 35 seconds.'
    }

    if ([string]::IsNullOrWhiteSpace($DependencyDir)) {
        throw 'PointBench dependencies are not installed. Install PointBench Dependencies first.'
    }

    $portablePython = Join-Path $dependencyRuntimeDir 'python\python.exe'
    if (-not (Test-Path $portablePython)) {
        throw "Portable Python is missing: $portablePython. Reinstall PointBench Dependencies."
    }
    $pythonExe = $portablePython
    $env:PATH = "$(Join-Path $dependencyRuntimeDir 'python');$(Join-Path $dependencyRuntimeDir 'python\Scripts');$env:PATH"
    $env:PYTHONPATH = $backendDir

    $portableNode = Join-Path $dependencyRuntimeDir 'node\node.exe'
    if (-not (Test-Path $portableNode)) {
        throw "Portable Node.js is missing: $portableNode. Reinstall PointBench Dependencies."
    }
    $nodeExe = $portableNode
    $portableNpm = Join-Path $dependencyRuntimeDir 'node\npm.cmd'
    $npmExe = if (Test-Path $portableNpm) { $portableNpm } else { $null }
    $env:PATH = "$(Join-Path $dependencyRuntimeDir 'node');$env:PATH"

    $viteEntry = Join-Path $frontendDir 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path $viteEntry)) {
        $viteEntry = Join-Path $dependencyNodeModules 'vite\bin\vite.js'
    }
    if (-not (Test-Path $viteEntry)) {
        throw "Frontend dependencies are missing: $viteEntry. Reinstall PointBench Dependencies or repair the code installation."
    }

    Run-Preflight

    $backendCmd = Join-Path $logDir 'start-backend.cmd'
    $backendPy = Join-Path $logDir 'start-backend.py'
    $frontendCmd = Join-Path $logDir 'start-frontend.cmd'

    Set-TextFile -Path $backendPy -Value @(
        'import sys',
        ('sys.path.insert(0, r"{0}")' -f $backendDir),
        'import uvicorn',
        'uvicorn.run("app.main:app", host="127.0.0.1", port=8000, log_level="info", access_log=True)'
    )

    Set-TextFile -Path $backendCmd -Value @(
        '@echo off',
        'chcp 65001 >nul',
        ('echo ===== backend process bootstrap ===== >> "{0}"' -f $backendLog),
        ('echo time=%DATE% %TIME% >> "{0}"' -f $backendLog),
        'set PYTHONUNBUFFERED=1',
        'set PYTHONIOENCODING=utf-8',
        'set PYTHONFAULTHANDLER=1',
        ('set "PYTHONPATH={0}"' -f $backendDir),
        $(if ($userDataDir) { 'set "DATABASE_URL=sqlite:///{0}"' -f ((Join-Path $userDataDir 'pointbench.db').Replace('\', '/')) } else { 'rem DATABASE_URL uses the source-tree default' }),
        $(if ($userDataDir) { 'set "POINTBENCH_STORAGE_DIR={0}"' -f (Join-Path $userDataDir 'storage') } else { 'rem POINTBENCH_STORAGE_DIR uses the source-tree default' }),
        'set POINTBENCH_LOG_LEVEL=INFO',
        ('set POINTBENCH_ERROR_LOG={0}' -f $errorLog),
        ('cd /d "{0}"' -f $backendDir),
        ('echo cwd=%CD% >> "{0}"' -f $backendLog),
        ('echo PYTHONPATH=%PYTHONPATH% >> "{0}"' -f $backendLog),
        ('echo python="{0}" >> "{1}"' -f $pythonExe, $backendLog),
        ('echo command="{0}" -X faulthandler "{1}" >> "{2}"' -f $pythonExe, $backendPy, $backendLog),
        ('"{0}" -X faulthandler "{1}" >> "{2}" 2>&1' -f $pythonExe, $backendPy, $backendLog),
        ('echo backend_exit_code=%ERRORLEVEL% >> "{0}"' -f $backendLog),
        'exit /b %ERRORLEVEL%'
    )
    Set-TextFile -Path $frontendCmd -Value @(
        '@echo off',
        'chcp 65001 >nul',
        ('echo ===== frontend process bootstrap ===== >> "{0}"' -f $frontendLog),
        ('echo time=%DATE% %TIME% >> "{0}"' -f $frontendLog),
        'set NODE_OPTIONS=--trace-uncaught --trace-warnings',
        ('cd /d "{0}"' -f $frontendDir),
        ('echo cwd=%CD% >> "{0}"' -f $frontendLog),
        ('echo command="{0}" "{1}" --host 127.0.0.1 --port 5173 --clearScreen false >> "{2}"' -f $nodeExe, $viteEntry, $frontendLog),
        ('"{0}" "{1}" --host 127.0.0.1 --port 5173 --clearScreen false >> "{2}" 2>&1' -f $nodeExe, $viteEntry, $frontendLog),
        ('echo frontend_exit_code=%ERRORLEVEL% >> "{0}"' -f $frontendLog),
        'exit /b %ERRORLEVEL%'
    )

    Write-Console 'Starting PointBench...'
    Write-Console "Project: $root"
    Write-Console "Logs:    $logDir"
    Write-Console "Latest:  $latestLogDirFile"
    Write-Console ''

    $backendProc = Start-CmdScript -Name 'backend' -ScriptPath $backendCmd -WorkingDirectory $backendDir
    $frontendProc = Start-CmdScript -Name 'frontend' -ScriptPath $frontendCmd -WorkingDirectory $frontendDir

    if (-not (Wait-HttpReady -Name 'backend health' -Url 'http://127.0.0.1:8000/api/health' -BackendProcess $backendProc -FrontendProcess $frontendProc -TimeoutSeconds 30)) {
        Stop-ProcessTree $backendProc
        Stop-ProcessTree $frontendProc
        exit 1
    }
    if (-not (Wait-HttpReady -Name 'frontend' -Url 'http://127.0.0.1:5173/' -BackendProcess $backendProc -FrontendProcess $frontendProc -TimeoutSeconds 30)) {
        Stop-ProcessTree $backendProc
        Stop-ProcessTree $frontendProc
        exit 1
    }

    Open-PointBenchBrowser

    if ($ShowLogs) {
        Write-Host ''
        Write-Host 'PointBench is running. Close this window or press Ctrl+C to stop backend and frontend.'
        Write-Host ''
        Wait-UntilProcessExit -BackendProcess $backendProc -FrontendProcess $frontendProc
    }

    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
    } catch {
        Write-ExceptionLog -Title 'tray_initialization_failed' -Record $_ -Path $launcherLog
        Write-LauncherLog "Tray UI is unavailable; continuing without tray icon."
        Wait-UntilProcessExit -BackendProcess $backendProc -FrontendProcess $frontendProc
    }

    $trayIcon = New-Object System.Windows.Forms.NotifyIcon
    $iconPath = Join-Path $root 'assets\PointBench.ico'
    if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
        $trayIcon.Icon = New-Object System.Drawing.Icon($iconPath)
    } else {
        $trayIcon.Icon = [System.Drawing.SystemIcons]::Application
    }
    $trayIcon.Text = 'PointBench'
    $trayIcon.Visible = $true

    $menu = New-Object System.Windows.Forms.ContextMenuStrip

    $openBrowser = New-Object System.Windows.Forms.ToolStripMenuItem('Open Browser')
    $openBrowser.Add_Click({ Start-Process $appUrl })
    $menu.Items.Add($openBrowser) | Out-Null

    $menu.Items.Add('-') | Out-Null

    $exitItem = New-Object System.Windows.Forms.ToolStripMenuItem('Exit')
    $exitItem.Add_Click({
        $trayIcon.Visible = $false
        Stop-ProcessTree $backendProc
        Stop-ProcessTree $frontendProc
        [System.Windows.Forms.Application]::Exit()
    }.GetNewClosure())
    $menu.Items.Add($exitItem) | Out-Null

    $trayIcon.ContextMenuStrip = $menu
    $trayIcon.Add_Click({
        if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            Start-Process $appUrl
        }
    })
    $trayIcon.BalloonTipTitle = 'PointBench'
    $trayIcon.BalloonTipText = "Backend :8000 | Frontend :5173 | Logs: $runId"
    $trayIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $trayIcon.ShowBalloonTip(3000)

    [System.Windows.Forms.Application]::Run()

    $trayIcon.Visible = $false
    Stop-ProcessTree $backendProc
    Stop-ProcessTree $frontendProc
} catch {
    Write-LauncherLog "Unhandled launcher error: $($_.Exception.Message)"
    Write-ExceptionLog -Title 'unhandled_launcher_error' -Record $_ -Path $launcherLog
    Write-FailureSummary "Unhandled launcher error: $($_.Exception.Message)"
    Stop-ProcessTree $backendProc
    Stop-ProcessTree $frontendProc
    exit 1
}
