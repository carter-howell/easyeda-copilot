param(
  [string]$PackageFile = "",
  [string]$PackageDir = "",
  [string]$ProjectName = "CodexMCPFeatureTest",
  [string]$ProjectId = "f7b35105c12145fc9367e3e8e9e920c9",
  [int]$RemoteDebuggingPort = 9222,
  [switch]$Install,
  [switch]$Force
)
$ErrorActionPreference = "Stop"
$arguments = @{
  ProjectName = $ProjectName
  ProjectId = $ProjectId
  RemoteDebuggingPort = $RemoteDebuggingPort
  SelfTest = -not $Install
  Force = $Force
}
if ($PackageFile) { $arguments.PackageFile = $PackageFile }
if ($PackageDir) { $arguments.PackageDir = $PackageDir }
& (Join-Path $PSScriptRoot "update-easyeda-copilot-fast.ps1") @arguments
exit $LASTEXITCODE
