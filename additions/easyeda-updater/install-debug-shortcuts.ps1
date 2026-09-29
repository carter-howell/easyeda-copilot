[CmdletBinding()]
param(
    [int]$RemoteDebuggingPort = 9222,
    [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$easyEda = 'C:\Program Files\easyeda-pro\easyeda-pro.exe'
if (-not (Test-Path -LiteralPath $easyEda -PathType Leaf)) {
    throw "EasyEDA Pro was not found at $easyEda"
}

$workspaceRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$backupRoot = Join-Path $workspaceRoot ('shortcut-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$shell = New-Object -ComObject WScript.Shell
$arguments = "--remote-debugging-port=$RemoteDebuggingPort"
$roots = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('StartMenu'),
    [Environment]::GetFolderPath('CommonStartMenu'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

$shortcuts = foreach ($root in $roots) {
    Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue |
        Where-Object {
            $shortcut = $shell.CreateShortcut($_.FullName)
            [string]::Equals($shortcut.TargetPath, $easyEda, [System.StringComparison]::OrdinalIgnoreCase)
        }
}

$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'EasyEDA Pro.lnk'
$userStartShortcut = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\EasyEDA Pro.lnk'
foreach ($requiredShortcut in @($desktopShortcut, $userStartShortcut)) {
    if (-not ($shortcuts.FullName -contains $requiredShortcut)) {
        $shortcuts = @($shortcuts) + [System.IO.FileInfo]$requiredShortcut
    }
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$updated = @()
$skipped = @()
foreach ($file in $shortcuts) {
    try {
        if (Test-Path -LiteralPath $file.FullName) {
            $backupName = ([Convert]::ToHexString([Text.Encoding]::UTF8.GetBytes($file.FullName))) + '.lnk'
            Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $backupRoot $backupName) -Force
        } else {
            New-Item -ItemType Directory -Path (Split-Path -Parent $file.FullName) -Force | Out-Null
        }
        $shortcut = $shell.CreateShortcut($file.FullName)
        $shortcut.TargetPath = $easyEda
        $shortcut.Arguments = $arguments
        $shortcut.WorkingDirectory = Split-Path -Parent $easyEda
        $shortcut.IconLocation = "$easyEda,0"
        $shortcut.Description = "EasyEDA Pro with local extension debugging on port $RemoteDebuggingPort"
        $shortcut.Save()
        $updated += $file.FullName
    } catch {
        $skipped += [ordered]@{ path = $file.FullName; error = $_.Exception.Message }
    }
}

if ($Launch) {
    Start-Process -FilePath $easyEda -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $easyEda)
}

[ordered]@{
    port = $RemoteDebuggingPort
    backup = $backupRoot
    updated = $updated
    skipped = $skipped
    launched = [bool]$Launch
} | ConvertTo-Json -Depth 4
