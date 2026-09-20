param(
  [string]$PackageDir = "",
  [string]$PackageFile = "",
  [string]$ProjectName = "CodexMCPFeatureTest",
  [string]$ProjectId = "f7b35105c12145fc9367e3e8e9e920c9",
  [int]$RemoteDebuggingPort = 9222,
  [switch]$CleanStart,
  [switch]$Force,
  [switch]$SkipBridgeVerification,
  [switch]$SelfTest
)
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$workspaceRoot = Split-Path -Parent $repoRoot
$portableNode = Join-Path $workspaceRoot "tools/node-v24.21.0-win-x64/node.exe"
$node = if ($env:NODE_EXE) { $env:NODE_EXE } elseif (Test-Path -LiteralPath $portableNode) { $portableNode } else { (Get-Command node -ErrorAction Stop).Source }
$operations = Join-Path $PSScriptRoot "package-operations.mjs"
$launcher = Join-Path $PSScriptRoot "start-easyeda-codex-project.ps1"
if (-not $PackageFile) {
  if ($PackageDir) {
    $candidates = @(Get-ChildItem -LiteralPath $PackageDir -Filter '*.eext' -File)
    if ($candidates.Count -ne 1) { throw "PackageDir must contain exactly one package; select a package with -PackageFile." }
    $PackageFile = $candidates[0].FullName
  } else {
    $manifestPath = Join-Path $repoRoot "extension/extension.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if (-not $manifest.version) { throw "Extension manifest does not contain a version: $manifestPath" }
    $PackageFile = Join-Path $repoRoot ("build/dist/easyeda-copilot_v{0}.eext" -f $manifest.version)
  }
}
$PackageFile = (Resolve-Path -LiteralPath $PackageFile).Path
function Invoke-PackageOperation([string]$Operation) {
  $output = @(& $node $operations $Operation $PackageFile $ProjectId $RemoteDebuggingPort)
  if ($LASTEXITCODE -ne 0) { throw "Extension operation failed: $Operation" }
  $result = ($output -join [Environment]::NewLine) | ConvertFrom-Json
  if (-not $result.ok) { throw "Extension operation did not succeed: $Operation" }
  return $result.result
}
function Test-DebugPort {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$RemoteDebuggingPort/json/version" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch { return $false }
}
function Open-Project {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $launcher -ProjectName $ProjectName -ProjectId $ProjectId -RemoteDebuggingPort $RemoteDebuggingPort
  if ($LASTEXITCODE -ne 0) { throw "Project launcher failed." }
}
function Reload-SavedEditors {
  Invoke-PackageOperation "reload" | Out-Null
  Start-Sleep -Seconds 2
  Open-Project
  Invoke-PackageOperation "ready" | Out-Null
}
$expected = Invoke-PackageOperation "metadata"
if ($SelfTest) {
  $installed = Invoke-PackageOperation "verify"
  $bridge = Invoke-PackageOperation "bridge"
  @{ ok = $true; package = $expected; installed = $installed; bridge = $bridge } | ConvertTo-Json -Depth 8
  exit 0
}
if (-not (Test-DebugPort)) {
  if (Get-Process -Name easyeda-pro -ErrorAction SilentlyContinue) {
    throw "EasyEDA is running without its debugging port. Cannot verify saves; editor left open."
  }
  Open-Project
}
if ($CleanStart) { Reload-SavedEditors }
# -Force requests reinstallation only; it never permits discarding unsaved work.
Invoke-PackageOperation "save" | Out-Null
Invoke-PackageOperation "disable" | Out-Null
Reload-SavedEditors
Invoke-PackageOperation "install" | Out-Null
Invoke-PackageOperation "verify" | Out-Null
Reload-SavedEditors
$installed = Invoke-PackageOperation "verify"
if ($SkipBridgeVerification) { Write-Warning "-SkipBridgeVerification is deprecated; current bridge verification is required." }
$bridge = $null
for ($attempt = 0; $attempt -lt 6; $attempt++) {
  try { $bridge = Invoke-PackageOperation "bridge"; break }
  catch {
    if ($attempt -eq 5) { throw }
    Start-Sleep -Seconds 2
  }
}
@{ ok = $true; installed = $installed; bridge = $bridge } | ConvertTo-Json -Depth 8
Write-Host "Done. Package contents, enabled state, and project bridge verified."
