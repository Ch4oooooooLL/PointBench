param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectDir
)

# ============================================================
#  Pack source code only (excludes dependencies and data)
# ============================================================

$root = [System.IO.Path]::GetFullPath($ProjectDir.TrimEnd('\', '/', '"', ' '))
$output = Join-Path $root 'test-point-web-code.zip'

Write-Host "========================================"
Write-Host "  Pack test-point-web Source Code"
Write-Host "========================================"
Write-Host ""

if (Test-Path $output) {
    Remove-Item $output -Force
}

Write-Host "  Packing source files..."
Write-Host "  (skipping: node_modules, .venv, storage, outputs, caches)"
Write-Host ""

# Exclusion patterns (match against full path)
$exclude = @(
    '*\node_modules\*',
    '*\node_modules',
    '*.venv*',
    '*\__pycache__\*',
    '*.pyc',
    '*.db',
    '*.db-journal',
    '*.db-wal',
    '*\storage\*',
    '*\outputs\*',
    '*\.git\*',
    '*\pip-packages\*',
    '*\installers\*',
    '*node-modules.zip',
    '*node-modules.tar.gz',
    '*test-point-web-code.zip'
)

# Scan from root, exclude unwanted paths, collect into array
# Pass only FILES, not directories - Compress-Archive re-enumerates
# directory contents internally, bypassing our filter
$allFiles = @(Get-ChildItem -Path $root -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object {
    $full = $_.FullName
    foreach ($pat in $exclude) {
        if ($full -like $pat) { return $false }
    }
    try {
        $fs = [System.IO.File]::Open($full, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $fs.Close()
    } catch {
        Write-Host "  [SKIP] locked: $full"
        return $false
    }
    return $true
})

Write-Host "  Compressing $($allFiles.Count) files with folder structure..."

# Use .NET ZipFile to preserve directory structure
# (Compress-Archive in PS 5.1 flattens paths when using pipeline input)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($output, 'Create')
foreach ($f in $allFiles) {
    $entryPath = $f.FullName.Substring($root.Length).TrimStart('\', '/')
    try {
        $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $entryPath)
    } catch {
        Write-Host "  [SKIP] $entryPath : $_"
    }
}
$archive.Dispose()

if (-not (Test-Path $output)) {
    Write-Host ""
    Write-Host "[ERROR] Failed to create zip file."
    exit 1
}

$size = [math]::Round((Get-Item $output).Length / 1KB)

Write-Host ""
Write-Host "========================================"
Write-Host "  Pack complete!  (approx. ${size} KB)"
Write-Host "========================================"
Write-Host ""
Write-Host "  Output: test-point-web-code.zip"
Write-Host ""
Write-Host "  Included: all source code under:"
Write-Host "    backend\"
Write-Host "    frontend\"
Write-Host "    doc\"
Write-Host "    offline-install\"
Write-Host "    scripts\"
Write-Host "    sample_data\"
Write-Host "    + root .bat, .gitignore"
Write-Host ""
Write-Host "  Excluded:"
Write-Host "    node_modules\"
Write-Host "    .venv\"
Write-Host "    installers\  /  pip-packages\"
Write-Host "    node-modules.zip"
Write-Host "    storage\  /  outputs\"
Write-Host "    __pycache__\  /  .pyc"
Write-Host "    .git\"
Write-Host ""
