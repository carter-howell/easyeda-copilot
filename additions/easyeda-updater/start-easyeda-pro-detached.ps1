param(
  [int]$RemoteDebuggingPort = 9222
)

$ErrorActionPreference = "Stop"
if ($env:USERNAME -like 'CodexSandbox*' -or $env:USERPROFILE -match '[\\/]CodexSandbox[^\\/]*$') {
  throw "Refusing to launch EasyEDA under the sandbox Windows profile. Run this launcher in the interactive user's session with approved execution outside the sandbox."
}
$easyEda = "C:\Program Files\easyeda-pro\easyeda-pro.exe"

if (-not (Test-Path -LiteralPath $easyEda)) {
  throw "EasyEDA Pro was not found at $easyEda"
}

$args = "--remote-debugging-port=$RemoteDebuggingPort"

# Launch EasyEDA itself as a detached visible application. Keeping only a hidden
# cmd shim here can leave the Electron renderer alive without a usable foreground
# window, which prevents EasyEDA extension activation and MCP reconnects.
Start-Process -FilePath $easyEda -ArgumentList $args -WindowStyle Normal
