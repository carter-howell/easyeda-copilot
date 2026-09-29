[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('BackupOnly', 'HalfOffline')]
    [string]$Mode = 'BackupOnly',
    [string]$EasyEdaRoot = (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($EasyEdaRoot)
$configPath = Join-Path $root 'config.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "EasyEDA config not found: $configPath"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $root "project-safety-backups\$stamp"
$sources = @('config.json', 'projects', 'online-projects-backup', 'projects-recovery')

if ($PSCmdlet.ShouldProcess($backupRoot, 'Create EasyEDA project safety backup')) {
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    foreach ($relative in $sources) {
        $source = Join-Path $root $relative
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $backupRoot $relative) -Recurse -Force
        }
    }
}

$manifest = [ordered]@{
    createdAt = (Get-Date).ToString('o')
    sourceRoot = $root
    requestedMode = $Mode
    files = @()
}
Get-ChildItem -LiteralPath $backupRoot -File -Recurse | ForEach-Object {
    $manifest.files += [ordered]@{
        path = [System.IO.Path]::GetRelativePath($backupRoot, $_.FullName)
        length = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$manifestPath = Join-Path $backupRoot 'manifest.json'
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8

if ($Mode -eq 'HalfOffline') {
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -match '^easyeda-pro$|^easyeda$'
    })
    if ($running.Count) {
        throw "Backup completed at $backupRoot, but EasyEDA is running. Close it normally, then rerun this command to switch modes."
    }

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $config.type = 'HALF_OFFLINE'
    $temporaryPath = "$configPath.new"
    $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
    Move-Item -LiteralPath $temporaryPath -Destination $configPath -Force
}

[ordered]@{
    backup = $backupRoot
    manifest = $manifestPath
    mode = $Mode
    switched = $Mode -eq 'HalfOffline'
} | ConvertTo-Json -Depth 3
