<#
.SYNOPSIS
    Verify PointBench starts using ONLY the portable dependencies.

.DESCRIPTION
    Simulates the offline deployment scenario: a restricted PATH that exposes
    the portable Node.js and Python but no system Python/Node, then:
      1. checks the portable runtime is complete (python, node, encodings);
      2. imports every backend dependency and app.main with the portable
         interpreter;
      3. starts the backend (uvicorn, port 8000) and polls /api/health;
      4. starts the frontend (vite dev server, port 5173) and polls the page.
    Both servers are terminated before the script exits.

    By default the project's own runtime\ and frontend\node_modules are used.
    Pass -DependencyDir to test an extracted dependency installer or an
    installed dependency directory instead (offline-machine simulation).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\test-portable-startup.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\test-portable-startup.ps1 `
        -DependencyDir D:\extracted-deps
#>

[CmdletBinding()]
param(
    [string]$ProjectDir = '',
    [string]$DependencyDir = '',
    [switch]$KeepServers
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($ProjectDir)) { $ProjectDir = Join-Path $scriptDir '..' }
$project = [IO.Path]::GetFullPath($ProjectDir)
if ([string]::IsNullOrWhiteSpace($DependencyDir)) { $DependencyDir = $project }
$dependency = [IO.Path]::GetFullPath($DependencyDir)

$backendDir = Join-Path $project 'backend'
$frontendDir = Join-Path $project 'frontend'
$pythonExe = Join-Path $dependency 'runtime\python\python.exe'
$nodeExe = Join-Path $dependency 'runtime\node\node.exe'
$runtimePythonDir = Join-Path $dependency 'runtime\python'
$runtimeNodeDir = Join-Path $dependency 'runtime\node'
$pythonScriptsDir = Join-Path $runtimePythonDir 'Scripts'
$viteEntry = Join-Path $frontendDir 'node_modules\vite\bin\vite.js'
$encodingsProbe = Join-Path $dependency 'runtime\python\Lib\encodings\__init__.pyc'
$pthProbe = Join-Path $dependency 'runtime\python\python312._pth'

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("pointbench-portable-test-" + [guid]::NewGuid().ToString('N'))
$testDataDir = Join-Path $testRoot 'user-data'
$logDir = Join-Path $testRoot 'logs'
$backendLog = Join-Path $logDir 'backend.log'
$frontendLog = Join-Path $logDir 'frontend.log'
$backendReadyUrl = 'http://127.0.0.1:8000/api/health'
$frontendReadyUrl = 'http://127.0.0.1:5173/'
$backendPort = 8000
$frontendPort = 5173

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==== $Message ====" -ForegroundColor Cyan
}

function Test-HttpReady([string]$Url, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Stop-ProcessTreeById([int]$ProcessId) {
    if ($ProcessId -le 0) { return }
    try {
        & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
    }
    catch { }
}

function Reset-Environment {
    # Remove variables that could point the portable interpreter at a
    # system/venv Python; the launcher also does not set PYTHONHOME.
    Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    Remove-Item Env:VIRTUAL_ENV -ErrorAction SilentlyContinue
    Remove-Item Env:PYTHONNOUSERSITE -ErrorAction SilentlyContinue
    Remove-Item Env:PYTHONUSERBASE -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
}

function Set-RestrictedPath {
    # A PATH that can run the portable runtimes and core Windows tools but
    # hides any system Python/Node installation from the child processes.
    $systemRoot = $env:SystemRoot
    if ([string]::IsNullOrWhiteSpace($systemRoot)) { $systemRoot = 'C:\windows' }
    $windowsPath = @(
        (Join-Path $systemRoot 'System32'),
        $systemRoot,
        (Join-Path $systemRoot 'System32\Wbem'),
        (Join-Path $systemRoot 'System32\WindowsPowerShell\v1.0'),
        (Join-Path $systemRoot 'System32\OpenSSH')
    ) -join ';'
    $env:PATH = "$runtimeNodeDir;$runtimePythonDir;$pythonScriptsDir;$windowsPath"
}

$summary = [ordered]@{
    DependencyDir = $dependency
    RuntimeComplete = '未检测'
    PythonVersion = '未检测'
    PythonImports = '未检测'
    NodeVersion = '未检测'
    ViteVersion = '未检测'
    BackendReady = '未检测'
    FrontendReady = '未检测'
    LogDir = $logDir
}
$startedAt = Get-Date
$backendProc = $null
$frontendProc = $null
$overall = 'PASS'

try {
    New-Item -ItemType Directory -Path $testDataDir, $logDir -Force | Out-Null
    Reset-Environment

    Write-Step ('环境：项目=' + $project)
    Write-Host ('依赖根：' + $dependency)
    Write-Host ('测试数据目录：' + $testDataDir)

    Write-Step '1/5 便携运行时完整性'
    $missing = @()
    foreach ($probe in @($pythonExe, $nodeExe, $pthProbe, $encodingsProbe, $viteEntry)) {
        if (-not (Test-Path -LiteralPath $probe -PathType Leaf)) { $missing += $probe }
    }
    if ($missing.Count -gt 0) {
        $summary.RuntimeComplete = '失败'
        throw ("便携运行时/前端依赖不完整，缺失：" + ($missing -join '；'))
    }
    $summary.RuntimeComplete = '完整（python/node/encodings/_pth/vite 均在）'
    Write-Host $summary.RuntimeComplete

    Write-Step '2/5 便携 Python 与后端依赖导入'
    $pythonOutput = (& $pythonExe -V 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw ("便携 Python 无法运行：" + $pythonOutput) }
    $summary.PythonVersion = $pythonOutput
    Write-Host ('Python: ' + $pythonOutput)

    $importScript = @(
        'import sys',
        ('sys.path.insert(0, r"{0}")' -f $backendDir),
        'mods = ["fastapi","uvicorn","sqlalchemy","alembic","jose","pydantic","pydantic_settings","multipart","jsonschema","aiofiles","dwdatareader","numpy","pandas","openpyxl"]',
        'for m in mods:',
        '    __import__(m)',
        'import app.main',
        'print("backend imports ok")'
    ) -join "`n"
    # The portable interpreter gets the probe from a real file: a multi-line
    # -c argument can be mangled by the command-line encoding on Windows.
    $importProbe = Join-Path $logDir 'import-probe.py'
    Set-Content -LiteralPath $importProbe -Value $importScript -Encoding UTF8
    $pythonImports = (& $pythonExe $importProbe 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        $summary.PythonImports = '失败'
        throw ("后端依赖导入失败：`n" + $pythonImports)
    }
    $summary.PythonImports = '全部导入成功（含 app.main）'
    Write-Host $pythonImports

    Write-Step '3/5 便携 Node 与 Vite'
    $nodeVersion = (& $nodeExe --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw ("便携 Node 无法运行：" + $nodeVersion) }
    $summary.NodeVersion = $nodeVersion
    Write-Host ('Node: ' + $nodeVersion)
    $viteVersion = (& $nodeExe $viteEntry --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw ("Vite 无法运行：" + $viteVersion) }
    $summary.ViteVersion = $viteVersion
    Write-Host ('Vite: ' + $viteVersion)

    Write-Step '4/5 启动后端并等待就绪'
    # Reject a conflicting instance so the probe cannot be satisfied by a
    # previously running PointBench/dev server.
    if (Test-HttpReady $backendReadyUrl 1 -or (Test-HttpReady $frontendReadyUrl 1)) {
        throw '端口 8000/5173 上已有服务在运行。请先关闭已启动的 PointBench 或开发服务器再测试。'
    }

    $env:PYTHONPATH = $backendDir
    $env:PYTHONUNBUFFERED = '1'
    $env:PYTHONIOENCODING = 'utf-8'
    $env:DATABASE_URL = 'sqlite:///' + ((Join-Path $testDataDir 'pointbench.db').Replace('\', '/'))
    $env:POINTBENCH_STORAGE_DIR = Join-Path $testDataDir 'storage'
    $backendScript = Join-Path $logDir 'start-backend.py'
    Set-Content -LiteralPath $backendScript -Value @(
        'import sys',
        ('sys.path.insert(0, r"{0}")' -f $backendDir),
        'import uvicorn',
        'uvicorn.run("app.main:app", host="127.0.0.1", port=8000, log_level="warning", access_log=False)'
    ) -Encoding UTF8
    $backendProc = Start-Process -FilePath $pythonExe -ArgumentList @('-X', 'faulthandler', $backendScript) `
        -WorkingDirectory $backendDir -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $backendLog -RedirectStandardError ($backendLog + '.err')
    Write-Host ("后端进程 PID=" + $backendProc.Id + "，等待 " + $backendReadyUrl)
    if (-not (Test-HttpReady $backendReadyUrl 45)) {
        $summary.BackendReady = '失败（超时）'
        throw ("后端未就绪。日志：" + $backendLog + "`n" + ((Get-Content -LiteralPath $backendLog -Raw -ErrorAction SilentlyContinue)))
    }
    $summary.BackendReady = '就绪（' + $backendReadyUrl + ' 返回 200）'
    Write-Host '后端已就绪。'

    Write-Step '5/5 启动前端并等待就绪'
    Remove-Item Env:DATABASE_URL, Env:POINTBENCH_STORAGE_DIR -ErrorAction SilentlyContinue
    $env:NODE_OPTIONS = ''
    $frontendProc = Start-Process -FilePath $nodeExe -ArgumentList @($viteEntry, '--host', '127.0.0.1', '--port', '5173', '--clearScreen', 'false') `
        -WorkingDirectory $frontendDir -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $frontendLog -RedirectStandardError ($frontendLog + '.err')
    Write-Host ("前端进程 PID=" + $frontendProc.Id + "，等待 " + $frontendReadyUrl)
    if (-not (Test-HttpReady $frontendReadyUrl 45)) {
        $summary.FrontendReady = '失败（超时）'
        throw ("前端未就绪。日志：" + $frontendLog + "`n" + ((Get-Content -LiteralPath $frontendLog -Raw -ErrorAction SilentlyContinue)))
    }
    $summary.FrontendReady = '就绪（' + $frontendReadyUrl + ' 返回 200）'
    Write-Host '前端已就绪。'
    Write-Host ''
    Write-Host '仅依赖便携运行时的启动验证成功：后端与前端均已实际启动并响应。' -ForegroundColor Green
}
catch {
    $overall = 'FAIL'
    Write-Host ''
    Write-Host ('失败：' + $_.Exception.Message) -ForegroundColor Red
    if (Test-Path -LiteralPath $backendLog) {
        Write-Host '---- 后端日志尾部 ----' -ForegroundColor Yellow
        Get-Content -LiteralPath $backendLog -Tail 30 | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path -LiteralPath $frontendLog) {
        Write-Host '---- 前端日志尾部 ----' -ForegroundColor Yellow
        Get-Content -LiteralPath $frontendLog -Tail 30 | ForEach-Object { Write-Host $_ }
    }
}
finally {
    if (-not $KeepServers) {
        if ($null -ne $backendProc) { Stop-ProcessTreeById $backendProc.Id }
        if ($null -ne $frontendProc) { Stop-ProcessTreeById $frontendProc.Id }
    }
}

Write-Host ''
Write-Host '========== 便携启动测试摘要 =========='
Write-Host ('总体：' + $overall)
Write-Host ('依赖根：' + $summary.DependencyDir)
Write-Host ('运行时完整性：' + $summary.RuntimeComplete)
Write-Host ('Python：' + $summary.PythonVersion)
Write-Host ('后端导入：' + $summary.PythonImports)
Write-Host ('Node：' + $summary.NodeVersion)
Write-Host ('Vite：' + $summary.ViteVersion)
Write-Host ('后端就绪：' + $summary.BackendReady)
Write-Host ('前端就绪：' + $summary.FrontendReady)
Write-Host ('日志目录：' + $summary.LogDir)
Write-Host ('耗时：{0:N1} 秒' -f ((Get-Date) - $startedAt).TotalSeconds)
Write-Host '========================================'

if ($overall -eq 'FAIL') { exit 1 }
exit 0
