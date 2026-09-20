# EasyEDA Pro DevTools Automation Helpers

These scripts control an already-running EasyEDA Pro window through Chrome DevTools Protocol. Start EasyEDA with:

```powershell
Start-Process -FilePath 'C:\Program Files\easyeda-pro\easyeda-pro.exe' -ArgumentList '--remote-debugging-port=9222'
```

## Preferred Extension Update

For normal fork updates, use the wrapper script instead of calling these low-level helpers directly:

```powershell
powershell -ExecutionPolicy Bypass -File .\main\additions\easyeda-updater\update-easyeda-copilot-fast.ps1 -Force
```

The wrapper finds the newest `easyeda-copilot-fork_v*.eext`, launches/reopens the project on the remote-debugging port, imports through EasyEDA's extension API, enables the extension, restarts EasyEDA, and verifies the loaded version.

## Low-Level Importer

Install a specific locally built `.eext` without using the Extension Manager import dialog:

```powershell
node .\main\additions\easyeda-updater\easyeda-devtools\install-easyeda-pro-extension-package.mjs .\easyeda-copilot-fork_v29.eext
```

Dry-run first if you only want to verify the package and create a backup:

```powershell
node .\main\additions\easyeda-updater\easyeda-devtools\install-easyeda-pro-extension-package.mjs .\easyeda-copilot-fork_v29.eext --dry-run
```

The installer writes a JSON backup under `backups/`, preserves the existing extension UUID and permissions, and then EasyEDA should be restarted so the new extension code is loaded.

## Helper Scripts

- `run-easyeda-pro-devtools-expression.mjs`: Executes a JavaScript expression inside the EasyEDA Pro renderer. Used by the updater and project launcher.
- `install-easyeda-pro-extension-package.mjs`: Imports one `.eext` package into EasyEDA's extension storage via the renderer extension API. Use for debugging a specific package import.
- `dispatch-easyeda-pro-mouse-event.mjs`: Sends a mouse event to the EasyEDA renderer through DevTools. This is a debugging helper; normal MCP workflows should use native MCP commands or the updater wrapper.
