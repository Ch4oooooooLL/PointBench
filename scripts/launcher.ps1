param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectDir,

    [switch]$ShowLogs
)

$ErrorActionPreference = 'Stop'

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

Set-Content -Path $latestLogDirFile -Value $logDir -Encoding UTF8
Set-Content -Path $launcherLog -Value ("[{0}] Starting launcher. ShowLogs={1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $ShowLogs) -Encoding UTF8
Set-Content -Path $backendLog -Value ("[{0}] Backend log started." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8
Set-Content -Path $frontendLog -Value ("[{0}] Frontend log started." -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8

$logOffsets = @{}

function Write-LauncherLog {
    param([string]$Text)
    Add-Content -Path $launcherLog -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text) -Encoding UTF8
}

function Write-Console {
    param([string]$Text)
    if ($ShowLogs) {
        Write-Host $Text
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
    Write-LogTail -Title 'backend' -Path $backendLog
    Write-LogTail -Title 'frontend' -Path $frontendLog
    Write-Console ''
    Write-Console "Startup failure: $Reason"
    Write-Console "Launcher log: $launcherLog"
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

    Add-Content -Path $LogPath -Value '' -Encoding UTF8
    Add-Content -Path $LogPath -Value ("===== diagnostic: {0} =====" -f $Name) -Encoding UTF8
    Add-Content -Path $LogPath -Value ("cwd={0}" -f $WorkingDirectory) -Encoding UTF8
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

function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)

    if ($Process -and -not $Process.HasExited) {
        & taskkill /PID $Process.Id /T /F 2>$null
    }
}

function Release-Port {
    param([string]$Port)

    $null = & netstat -ano 2>$null | Select-String (":{0}.*LISTENING" -f $Port) | ForEach-Object {
        $parts = $_ -split '\s+'
        if ($parts[-1] -match '^\d+$') {
            Write-LauncherLog "Killing existing process on port $Port. PID=$($parts[-1])"
            & taskkill /PID $parts[-1] /F 2>$null
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

try {
    $venvPython = Join-Path $root 'backend\.venv\Scripts\python.exe'
    if (Test-Path $venvPython) {
        $pythonExe = $venvPython
    } else {
        $pythonExe = 'python'
    }

    Run-Preflight

    Release-Port '8000'
    Release-Port '5173'

    $backendCmd = Join-Path $logDir 'start-backend.cmd'
    $frontendCmd = Join-Path $logDir 'start-frontend.cmd'
    $backendDir = Join-Path $root 'backend'
    $frontendDir = Join-Path $root 'frontend'

    Set-Content -Path $backendCmd -Encoding ASCII -Value @(
        '@echo off',
        'set PYTHONUNBUFFERED=1',
        'set PYTHONIOENCODING=utf-8',
        ('cd /d "{0}"' -f $backendDir),
        ('"{0}" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info >> "{1}" 2>&1' -f $pythonExe, $backendLog),
        ('echo backend_exit_code=%ERRORLEVEL% >> "{0}"' -f $backendLog),
        'exit /b %ERRORLEVEL%'
    )
    Set-Content -Path $frontendCmd -Encoding ASCII -Value @(
        '@echo off',
        ('cd /d "{0}"' -f $frontendDir),
        ('npm run dev >> "{0}" 2>&1' -f $frontendLog),
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

    Start-Process 'http://localhost:5173'

    if ($ShowLogs) {
        Write-Host ''
        Write-Host 'PointBench is running. Close this window or press Ctrl+C to stop backend and frontend.'
        Write-Host ''
        while (-not $backendProc.HasExited -and -not $frontendProc.HasExited) {
            Write-AllNewLogs
            Start-Sleep -Seconds 1
        }
        Write-AllNewLogs
        $backendExit = if ($backendProc.HasExited) { $backendProc.ExitCode } else { 'running' }
        $frontendExit = if ($frontendProc.HasExited) { $frontendProc.ExitCode } else { 'running' }
        Write-FailureSummary "Process exited. Backend=$backendExit Frontend=$frontendExit"
        Stop-ProcessTree $backendProc
        Stop-ProcessTree $frontendProc
        exit 1
    }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $trayIcon = New-Object System.Windows.Forms.NotifyIcon
    $trayIcon.Icon = [System.Drawing.SystemIcons]::Application
    $trayIcon.Text = 'test-point-web'
    $trayIcon.Visible = $true

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
    $trayIcon.Add_Click({
        if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            Start-Process 'http://localhost:5173'
        }
    })
    $trayIcon.BalloonTipTitle = 'test-point-web'
    $trayIcon.BalloonTipText = "Backend :8000 | Frontend :5173 | Logs: $runId"
    $trayIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $trayIcon.ShowBalloonTip(3000)

    [System.Windows.Forms.Application]::Run()

    $trayIcon.Visible = $false
    Stop-ProcessTree $backendProc
    Stop-ProcessTree $frontendProc
} catch {
    Write-LauncherLog "Unhandled launcher error: $($_.Exception.Message)"
    Write-LauncherLog "At: $($_.InvocationInfo.PositionMessage)"
    Write-FailureSummary "Unhandled launcher error: $($_.Exception.Message)"
    Stop-ProcessTree $backendProc
    Stop-ProcessTree $frontendProc
    exit 1
}
