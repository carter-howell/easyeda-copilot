param(
  [switch]$UseRecordedCoordinateFallback
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$easy = $null
foreach ($window in $windows) {
  $processId = $window.Current.ProcessId
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'easyeda-pro') {
    $easy = $window
    break
  }
}

if (-not $easy) {
  throw 'EasyEDA Pro window was not found.'
}

$buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty,
  'Apply Changes'
)
$button = $easy.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)

if ($button) {
  $rect = $button.Current.BoundingRectangle
  Write-Output "Found Apply Changes at left=$($rect.Left), top=$($rect.Top), width=$($rect.Width), height=$($rect.Height)."
  $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  Write-Output 'Invoked Apply Changes by UI Automation.'
  exit 0
}

if (-not $UseRecordedCoordinateFallback) {
  throw 'Apply Changes button was not found. Re-run with -UseRecordedCoordinateFallback to click the recorded center point from the captured dialog.'
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MouseClicker {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
"@

# Recorded from EasyEDA Pro V3.2.149 on this machine while the import dialog was open:
# Apply Changes rect: left=1165, top=869, width=129, height=36. Center: 1230,887.
[MouseClicker]::SetCursorPos(1230, 887) | Out-Null
Start-Sleep -Milliseconds 80
[MouseClicker]::mouse_event([MouseClicker]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[MouseClicker]::mouse_event([MouseClicker]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Write-Output 'Clicked recorded Apply Changes coordinate 1230,887.'