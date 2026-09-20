param(
  [string]$ProjectName = "CodexMCPFeatureTest",
  [string]$ProjectId = "f7b35105c12145fc9367e3e8e9e920c9",
  [int]$RemoteDebuggingPort = 9222,
  [int]$Attempts = 8
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $root "start-easyeda-pro-detached.ps1"
$helper = Join-Path $root "easyeda-devtools\run-easyeda-pro-devtools-expression.mjs"
$workspaceRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $root))
$portableNode = Join-Path $workspaceRoot "tools\node-v24.21.0-win-x64\node.exe"
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$node = if ($env:NODE_EXE) { $env:NODE_EXE } elseif (Test-Path -LiteralPath $portableNode) { $portableNode } elseif ($nodeCommand) { $nodeCommand.Source } else { "C:\Program Files\nodejs\node.exe" }

if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Missing EasyEDA detached launcher: $launcher"
}

if (-not (Test-Path -LiteralPath $helper)) {
  throw "Missing EasyEDA DevTools helper: $helper"
}

if (-not (Test-Path -LiteralPath $node)) {
  throw "Node.js was not found at $node"
}

function Test-EasyEdaDebugPort {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$RemoteDebuggingPort/json/version" -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-KnownStartupWait([string]$Message) {
  return $Message -match "EasyEDA debug port is not ready" `
    -or $Message -match "No EasyEDA page target found"
}

if (-not (Test-EasyEdaDebugPort)) {
  $existing = @(Get-Process -Name 'easyeda-pro' -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) {
    throw "EasyEDA is already running but debug port $RemoteDebuggingPort is unavailable. No second instance was launched. Save your work and close/restart the existing editor with debugging enabled, or use its connected MCP instance."
  }
  & $launcher -RemoteDebuggingPort $RemoteDebuggingPort
}

$env:EASYEDA_REMOTE_DEBUGGING_PORT = [string]$RemoteDebuggingPort
$env:EASYEDA_PROJECT_ID = $ProjectId
$projectNameJson = ConvertTo-Json $ProjectName -Compress
$projectIdJson = ConvertTo-Json $ProjectId -Compress

$expressionTemplate = @'
(async () => {
  const projectName = __PROJECT_NAME__;
  const projectId = __PROJECT_ID__;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isOpen = () => {
    const hash = location.hash.slice(1);
    const idMatch = hash.match(/(?:^|[&,])id=([^&,]+)/);
    return idMatch ? decodeURIComponent(idMatch[1]) === projectId : false;
  };

  if (isOpen()) {
    return {
      ok: true,
      alreadyOpen: true,
      openMethod: "project_id",
      title: document.title,
      href: location.href
    };
  }

  const startDeadline = Date.now() + 12000;
  while (Date.now() < startDeadline && !(document.body && document.body.innerText && document.body.innerText.includes("Recent Design"))) {
    await sleep(500);
  }

  const scrollCandidates = [...document.querySelectorAll("div")]
    .filter((el) => el.scrollHeight > el.clientHeight && (el.innerText || "").includes("Recent Design"));

  for (const scroller of scrollCandidates) {
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(150);
    scroller.scrollTop = Math.max(80, scroller.scrollHeight - scroller.clientHeight);
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(250);
  }

  const projectRows = [...document.querySelectorAll('td[data-col-key="prj_name"] span, p.prj_item_ktEqs, p')]
    .filter((el) => (el.innerText || "").trim() === projectName);

  const row = projectRows[0];
  if (!row) {
    const hashDeadline = Date.now() + 5000;
    while (Date.now() < hashDeadline && !isOpen()) {
      await sleep(500);
    }
    if (isOpen()) {
      return {
        ok: true,
        alreadyOpen: false,
        openMethod: "url_or_hash_after_start_page_wait",
        optionalStartPageRowLookup: "not_found",
        title: document.title,
        href: location.href
      };
    }
    return {
      ok: false,
      reason: "optional Start Page project row lookup did not find the project yet",
      optionalStartPageRowLookup: "not_found",
      title: document.title,
      href: location.href,
      bodyHasProject: !!(document.body && document.body.innerText && document.body.innerText.includes(projectName))
    };
  }

  const propKey = Object.keys(row).find((key) => key.startsWith("__reactProps$"));
  const props = propKey ? row[propKey] : null;
  if (!props || typeof props.onClick !== "function") {
    row.click();
  } else {
    const result = props.onClick({
      type: "click",
      target: row,
      currentTarget: row,
      preventDefault() {},
      stopPropagation() {}
    });
    if (result && typeof result.then === "function") {
      await result;
    }
  }

  const openDeadline = Date.now() + 15000;
  while (Date.now() < openDeadline && !isOpen()) {
    await sleep(500);
  }

  return {
    ok: isOpen(),
    alreadyOpen: false,
    openMethod: isOpen() ? "start_page_row" : "start_page_row_no_confirm",
    title: document.title,
    href: location.href
  };
})()
'@

$expression = $expressionTemplate.
  Replace("__PROJECT_NAME__", $projectNameJson).
  Replace("__PROJECT_ID__", $projectIdJson)

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
  $expressionPath = Join-Path $env:TEMP "easyeda-open-codex-project-$PID-$attempt.js"
  try {
    Set-Content -LiteralPath $expressionPath -Value $expression -Encoding UTF8
    $raw = @(& $node $helper --file $expressionPath 2>&1 | ForEach-Object { "$_" })
    if ($LASTEXITCODE -ne 0) { throw ($raw -join [Environment]::NewLine) }
    $result = $raw | ConvertFrom-Json
    if ($result.ok) {
      $openMethod = if ($result.openMethod) { $result.openMethod } else { "unknown" }
      Write-Host "EasyEDA project is open via $openMethod`: $($result.title)"
      Write-Host $result.href
      exit 0
    }

    Write-Host "Attempt $attempt/$Attempts has not confirmed the project yet: $($result.reason)"
    if ($result.optionalStartPageRowLookup) {
      Write-Host "Optional Start Page row lookup: $($result.optionalStartPageRowLookup); continuing toward URL/hash or bridge readiness confirmation."
    }
    Write-Host "Current page: $($result.title) $($result.href)"
  } catch {
    if (Test-KnownStartupWait $_.Exception.Message) {
      Write-Host "Attempt $attempt/$Attempts waiting for EasyEDA to expose the debug page."
    } else {
      Write-Host "Attempt $attempt/$Attempts waiting for EasyEDA debug port: $($_.Exception.Message)"
    }
  } finally {
    if (Test-Path -LiteralPath $expressionPath) {
      Remove-Item -LiteralPath $expressionPath -Force
    }
  }

  Start-Sleep -Seconds 2
}

throw "Could not open EasyEDA project '$ProjectName' after $Attempts attempts."
