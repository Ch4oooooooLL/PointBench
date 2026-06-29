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
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$launcherLog = Join-Path $logDir 'launcher.log'
$backendLog = Join-Path $logDir 'backend.log'
$frontendLog = Join-Path $logDir 'frontend.log'

Set-Content -Path $launcherLog -Value ("[{0}] Starting launcher. ShowLogs={1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $ShowLogs) -Encoding UTF8
Set-Content -Path $backendLog -Value ("[{0}] Backend log started." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8
Set-Content -Path $frontendLog -Value ("[{0}] Frontend log started." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8

function Write-LauncherLog {
    param([string]$Text)
    Add-Content -Path $launcherLog -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text) -Encoding UTF8
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

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    $label = $Name
    $path = $LogPath
    $proc.add_OutputDataReceived({
        if ($EventArgs.Data) {
            Add-Content -Path $path -Value ("[{0}] {1}" -f $label, $EventArgs.Data) -Encoding UTF8
        }
    }.GetNewClosure())
    $proc.add_ErrorDataReceived({
        if ($EventArgs.Data) {
            Add-Content -Path $path -Value ("[{0}] {1}" -f $label, $EventArgs.Data) -Encoding UTF8
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

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    $label = $Name
    $path = $LogPath
    $proc.add_OutputDataReceived({
        if ($EventArgs.Data) {
            Add-Content -Path $path -Value ("[{0}] {1}" -f $label, $EventArgs.Data) -Encoding UTF8
            Write-Host "[$label] $($EventArgs.Data)"
        }
    }.GetNewClosure())
    $proc.add_ErrorDataReceived({
        if ($EventArgs.Data) {
            Add-Content -Path $path -Value ("[{0}] {1}" -f $label, $EventArgs.Data) -Encoding UTF8
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

# --- Detect Python (prefer .venv) ---
$venvPython = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
    $pythonExe = $venvPython
} else {
    $pythonExe = 'python'
}
Write-LauncherLog "Python executable: $pythonExe"

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

    Start-Sleep -Seconds 4
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
Start-Sleep -Seconds 4

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
