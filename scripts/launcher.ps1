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

# --- Helper: start a hidden process ---
function Start-HiddenProcess {
    param([string]$FilePath, [string]$Arguments, [string]$WorkingDirectory)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = $Arguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false
    return [System.Diagnostics.Process]::Start($psi)
}

function Start-LoggedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string]$Arguments,
        [string]$WorkingDirectory
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
    $proc.add_OutputDataReceived({
        if ($EventArgs.Data) {
            Write-Host "[$label] $($EventArgs.Data)"
        }
    }.GetNewClosure())
    $proc.add_ErrorDataReceived({
        if ($EventArgs.Data) {
            Write-Host "[$label] $($EventArgs.Data)"
        }
    }.GetNewClosure())

    [void]$proc.Start()
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
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
    Write-Host ''

    $backendArgs = '-m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info'
    $backendProc = Start-LoggedProcess -Name 'backend' `
        -FilePath $pythonExe `
        -Arguments $backendArgs `
        -WorkingDirectory (Join-Path $root 'backend')

    $frontendProc = Start-LoggedProcess -Name 'frontend' `
        -FilePath 'cmd.exe' `
        -Arguments '/c npm run dev' `
        -WorkingDirectory (Join-Path $root 'frontend')

    Start-Sleep -Seconds 4
    Start-Process 'http://localhost:5173'

    Write-Host ''
    Write-Host 'PointBench is running. Close this window or press Ctrl+C to stop backend and frontend.'
    Write-Host ''

    try {
        while (($backendProc -and -not $backendProc.HasExited) -or ($frontendProc -and -not $frontendProc.HasExited)) {
            Start-Sleep -Seconds 1
        }
    } finally {
        Stop-ProcessTree $backendProc
        Stop-ProcessTree $frontendProc
    }

    return
}

# --- Start backend (hidden, no window) ---
$backendArgs = '-m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level warning'
$backendProc = Start-HiddenProcess -FilePath $pythonExe `
    -Arguments $backendArgs `
    -WorkingDirectory (Join-Path $root 'backend')

# --- Start frontend (hidden, no window) ---
$frontendProc = Start-HiddenProcess -FilePath 'cmd.exe' `
    -Arguments '/c npm run dev' `
    -WorkingDirectory (Join-Path $root 'frontend')

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
