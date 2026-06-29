param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectDir,

    [switch]$ShowLogs
)

# ============================================================
#  Tray-based launcher for test-point-web
#  Default mode: starts backend + frontend hidden, shows tray icon
#  ShowLogs mode: streams backend + frontend logs in the current console
#  No admin rights required
# ============================================================

$root = $ProjectDir.TrimEnd('\', '/', '"', ' ')
$logRoot = Join-Path $root 'logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$logDir = Join-Path $logRoot $runId
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$launcherLog = Join-Path $logDir 'launcher.log'
$backendLog = Join-Path $logDir 'backend.log'
$frontendLog = Join-Path $logDir 'frontend.log'
$latestLogDirFile = Join-Path $logRoot 'latest-run.txt'

Set-Content -Path $launcherLog -Value ("[{0}] Starting launcher. ShowLogs={1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $ShowLogs) -Encoding UTF8
Set-Content -Path $backendLog -Value ("[{0}] Backend log started." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8
Set-Content -Path $frontendLog -Value ("[{0}] Frontend log started." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8
Set-Content -Path $latestLogDirFile -Value $logDir -Encoding UTF8

function Write-LauncherLog {
    param([string]$Text)
    Add-Content -Path $launcherLog -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text) -Encoding UTF8
}

trap {
    Write-LauncherLog "Unhandled launcher error: $($_.Exception.Message)"
    Write-LauncherLog "At: $($_.InvocationInfo.PositionMessage)"
    if ($ShowLogs) {
        Write-Host ''
        Write-Host "Unhandled launcher error: $($_.Exception.Message)"
        Write-Host "Launcher log: $launcherLog"
        Write-Host "Backend log:  $backendLog"
        Write-Host "Frontend log: $frontendLog"
    }
    exit 1
}

function Write-LogTail {
    param(
        [string]$Title,
        [string]$Path,
        [int]$Tail = 80,
        [switch]$Console
    )

    Write-LauncherLog "===== $Title tail: $Path ====="
    if (-not (Test-Path $Path)) {
        Write-LauncherLog "$Title log is missing."
        if ($Console) {
            Write-Host "[$Title] log is missing: $Path"
        }
        return
    }

    $lines = Get-Content -Path $Path -Tail $Tail -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        Write-LauncherLog "$Title> $line"
    }
    if ($Console) {
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
    Write-LogTail -Title 'backend' -Path $backendLog -Console:$ShowLogs
    Write-LogTail -Title 'frontend' -Path $frontendLog -Console:$ShowLogs
    if ($ShowLogs) {
        Write-Host ''
        Write-Host "Startup failure: $Reason"
        Write-Host "Launcher log: $launcherLog"
        Write-Host "Backend log:  $backendLog"
        Write-Host "Frontend log: $frontendLog"
    }
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

    Add-Content -Path $LogPath -Value '' -Encoding UTF8
    Add-Content -Path $LogPath -Value ("===== diagnostic: {0} =====" -f $Name) -Encoding UTF8
    Add-Content -Path $LogPath -Value ("> {0} {1}" -f $FilePath, $Arguments) -Encoding UTF8
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
            Add-Content -Path $LogPath -Value $stdout -Encoding UTF8
        }
        if ($stderr) {
            Add-Content -Path $LogPath -Value $stderr -Encoding UTF8
        }
        Add-Content -Path $LogPath -Value ("exit_code={0}" -f $proc.ExitCode) -Encoding UTF8
        Write-LauncherLog "Diagnostic finished: $Name ExitCode=$($proc.ExitCode)"

        if ($Required -and $proc.ExitCode -ne 0) {
            throw "Diagnostic failed: $Name. See $LogPath"
        }
    } catch {
        Add-Content -Path $LogPath -Value ("diagnostic_exception={0}" -f $_.Exception.Message) -Encoding UTF8
        Write-LauncherLog "Diagnostic exception: $Name $($_.Exception.Message)"
        if ($Required) {
            throw
        }
    }
}

function Run-Preflight {
    Write-LauncherLog "Project root: $root"
    Write-LauncherLog "Log directory: $logDir"
    Write-LauncherLog "PowerShell: $($PSVersionTable.PSVersion)"
    Write-LauncherLog "PATH: $env:PATH"
    Write-LauncherLog "Python executable: $pythonExe"

    Invoke-DiagnosticCommand -Name 'python-version' `
        -FilePath $pythonExe `
        -Arguments '--version' `
        -WorkingDirectory (Join-Path $root 'backend') `
        -LogPath $backendLog `
        -Required

    Invoke-DiagnosticCommand -Name 'backend-import-check' `
        -FilePath $pythonExe `
        -Arguments '-c "import sys; print(sys.executable); import fastapi, uvicorn, sqlalchemy, alembic, jose; import app.main; print(''backend import ok'')"' `
        -WorkingDirectory (Join-Path $root 'backend') `
        -LogPath $backendLog `
        -Required

    Invoke-DiagnosticCommand -Name 'node-version' `
        -FilePath 'cmd.exe' `
        -Arguments '/c node --version' `
        -WorkingDirectory (Join-Path $root 'frontend') `
        -LogPath $frontendLog `
        -Required

    Invoke-DiagnosticCommand -Name 'npm-version' `
        -FilePath 'cmd.exe' `
        -Arguments '/c npm --version' `
        -WorkingDirectory (Join-Path $root 'frontend') `
        -LogPath $frontendLog `
        -Required

    Invoke-DiagnosticCommand -Name 'frontend-package-check' `
        -FilePath 'cmd.exe' `
        -Arguments '/c npm ls vite @vitejs/plugin-react react react-dom --depth=0' `
        -WorkingDirectory (Join-Path $root 'frontend') `
        -LogPath $frontendLog
}

# --- Helper: start a hidden process ---
function Start-HiddenProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [string]$LogPath
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables['PYTHONUNBUFFERED'] = '1'
    $psi.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'

    Add-Content -Path $LogPath -Value '' -Encoding UTF8
    Add-Content -Path $LogPath -Value ("===== start {0}: {1} {2} =====" -f $Name, $FilePath, $Arguments) -Encoding UTF8
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    $path = $LogPath
    $proc.add_OutputDataReceived({
        if ($EventArgs.Data) {
            Add-Content -Path $path -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) -Encoding UTF8
        }
    }.GetNewClosure())
    $proc.add_ErrorDataReceived({
        if ($EventArgs.Data) {
            Add-Content -Path $path -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) -Encoding UTF8
        }
    }.GetNewClosure())

    [void]$proc.Start()
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    Write-LauncherLog "$Name started. PID=$($proc.Id)"
    return $proc
}

function Start-LoggedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [string]$LogPath
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables['PYTHONUNBUFFERED'] = '1'
    $psi.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    $label = $Name
    $path = $LogPath
    $proc.add_OutputDataReceived({
        if ($EventArgs.Data) {
            Add-Content -Path $path -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) -Encoding UTF8
            Write-Host "[$label] $($EventArgs.Data)"
        }
    }.GetNewClosure())
    $proc.add_ErrorDataReceived({
        if ($EventArgs.Data) {
            Add-Content -Path $path -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) -Encoding UTF8
            Write-Host "[$label] $($EventArgs.Data)"
        }
    }.GetNewClosure())

    [void]$proc.Start()
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    Write-LauncherLog "$Name started. PID=$($proc.Id)"
    return $proc
}

function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)

    if ($Process -and -not $Process.HasExited) {
        & taskkill /PID $Process.Id /T /F 2>$null
    }
}

function Wait-HttpReady {
    param(
        [string]$Name,
        [string]$Url,
        [System.Diagnostics.Process]$BackendProcess,
        [System.Diagnostics.Process]$FrontendProcess,
        [int]$TimeoutSeconds = 30
    )

    Write-LauncherLog "Waiting for $Name: $Url"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    while ((Get-Date) -lt $deadline) {
        if ($BackendProcess -and $BackendProcess.HasExited) {
            $reason = "Backend exited while waiting for $Name. ExitCode=$($BackendProcess.ExitCode)"
            Write-FailureSummary $reason
            return $false
        }
        if ($FrontendProcess -and $FrontendProcess.HasExited) {
            $reason = "Frontend exited while waiting for $Name. ExitCode=$($FrontendProcess.ExitCode)"
            Write-FailureSummary $reason
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

# --- Detect Python (prefer .venv) ---
$venvPython = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
    $pythonExe = $venvPython
} else {
    $pythonExe = 'python'
}
try {
    Run-Preflight
} catch {
    Write-LauncherLog "Preflight failed: $($_.Exception.Message)"
    if ($ShowLogs) {
        Write-Host ''
        Write-Host "Startup diagnostics failed: $($_.Exception.Message)"
        Write-Host "Backend log:  $backendLog"
        Write-Host "Frontend log: $frontendLog"
        Write-Host "Launcher log: $launcherLog"
    }
    throw
}

# --- Release occupied ports (ignore errors) ---
$null = & netstat -ano 2>$null | Select-String ':8000.*LISTENING' | ForEach-Object {
    $parts = $_ -split '\s+'
    if ($parts[-1] -match '^\d+$') { & taskkill /PID $parts[-1] /F 2>$null }
}
$null = & netstat -ano 2>$null | Select-String ':5173.*LISTENING' | ForEach-Object {
    $parts = $_ -split '\s+'
    if ($parts[-1] -match '^\d+$') { & taskkill /PID $parts[-1] /F 2>$null }
}

if ($ShowLogs) {
    Write-Host 'Starting PointBench...'
    Write-Host "Project: $root"
    Write-Host "Logs:    $logDir"
    Write-Host "Latest:  $latestLogDirFile"
    Write-Host ''

    $backendArgs = '-m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info'
    $backendProc = Start-LoggedProcess -Name 'backend' `
        -FilePath $pythonExe `
        -Arguments $backendArgs `
        -WorkingDirectory (Join-Path $root 'backend') `
        -LogPath $backendLog

    $frontendProc = Start-LoggedProcess -Name 'frontend' `
        -FilePath 'cmd.exe' `
        -Arguments '/c npm run dev' `
        -WorkingDirectory (Join-Path $root 'frontend') `
        -LogPath $frontendLog

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

    Start-Process 'http://localhost:5173'

    Write-Host ''
    Write-Host 'PointBench is running. Close this window or press Ctrl+C to stop backend and frontend.'
    Write-Host ''

    try {
        while ($backendProc -and $frontendProc -and -not $backendProc.HasExited -and -not $frontendProc.HasExited) {
            Start-Sleep -Seconds 1
        }

        $backendExit = if ($backendProc.HasExited) { $backendProc.ExitCode } else { 'running' }
        $frontendExit = if ($frontendProc.HasExited) { $frontendProc.ExitCode } else { 'running' }
        $exitText = "Process exited. Backend=$backendExit Frontend=$frontendExit"
        Write-LauncherLog $exitText
        Write-Host ''
        Write-Host $exitText
        Write-Host "Backend log:  $backendLog"
        Write-Host "Frontend log: $frontendLog"
        Write-Host "Launcher log: $launcherLog"
    } finally {
        Stop-ProcessTree $backendProc
        Stop-ProcessTree $frontendProc
    }

    return
}

# --- Start backend (hidden, no window) ---
$backendArgs = '-m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level warning'
$backendProc = Start-HiddenProcess -Name 'backend' `
    -FilePath $pythonExe `
    -Arguments $backendArgs `
    -WorkingDirectory (Join-Path $root 'backend') `
    -LogPath $backendLog

# --- Start frontend (hidden, no window) ---
$frontendProc = Start-HiddenProcess -Name 'frontend' `
    -FilePath 'cmd.exe' `
    -Arguments '/c npm run dev' `
    -WorkingDirectory (Join-Path $root 'frontend') `
    -LogPath $frontendLog

# --- Wait for servers to be ready ---
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

# --- Open browser ---
Start-Process 'http://localhost:5173'

# --- Build tray icon ---
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Icon = [System.Drawing.SystemIcons]::Application
$trayIcon.Text = 'test-point-web'
$trayIcon.Visible = $true

# --- Context menu ---
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openBrowser = New-Object System.Windows.Forms.ToolStripMenuItem('Open Browser')
$openBrowser.Add_Click({ Start-Process 'http://localhost:5173' })
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

# --- Double-click opens browser ---
$trayIcon.Add_Click({
    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Start-Process 'http://localhost:5173'
    }
})

# --- Show balloon tip ---
$trayIcon.BalloonTipTitle = 'test-point-web'
$trayIcon.BalloonTipText = 'Backend :8000 | Frontend :5173'
$trayIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$trayIcon.ShowBalloonTip(3000)

# --- Run message loop ---
[System.Windows.Forms.Application]::Run()

# --- Cleanup on exit ---
$trayIcon.Visible = $false
Stop-ProcessTree $backendProc
Stop-ProcessTree $frontendProc
