# EasyEDA Copilot Additions

This folder contains independently testable extension and MCP capabilities that are not yet part of upstream EasyEDA Copilot. Runtime hooks in the upstream workspaces are intentionally small; feature implementations remain here so each capability can be reviewed, tested, and proposed upstream separately.

## Feature map

- `easyeda-ui-automation/` contains Windows UI Automation helpers, including the `Apply Changes` dialog confirmer.
- `easyeda-updater/` contains the local EasyEDA extension updater, launcher, smoke test, and DevTools importer helpers.
- `easyeda-bridge/` calls the current MCP broker, with optional `--instance ID` targeting. Its router runner also accepts `--timeout-ms`; expiry or Ctrl+C requests cancellation through the MCP operation manager instead of abandoning a live routing job.
- `mcp/auto-router-compat.mjs` registers `auto_route_pcb`, a non-destructive compatibility entry point for EasyEDA desktop releases older than 3.2.162 that do not expose `pcb_Document.autoRouting()`. It preserves existing copper, imports the current native DRC rules, and uses the transactional router's supported KRT fallback when needed.
- `mcp/confirm-easyeda-import.mjs` confirms only the exact visible `Apply Changes` action and reports `applied`, `not_needed`, or `unavailable` instead of assuming success.
- `mcp/execute-js-control.mjs` exposes cooperative interruption without releasing the extension command queue or bypassing checkpoint scopes.
- `extension/` implements library search, exact library-device placement, whole-page schematic snapshots, cooperative execution control, and non-orphaning board cleanup.
- `tests/` contains regression tests for these additions.

Keep new plugin-specific helper code here instead of mixing it into the upstream source tree.

## Safety contracts

- Mutating schematic operations create a checkpoint first and restore it when placement, connection verification, or saving fails.
- Library placement resolves the exact device and owning library; it does not substitute a similarly named catalog item.
- Board deletion retains the board association until linked schematic and PCB cleanup succeeds, so a failed operation can be retried with the original document IDs.
- Router compatibility preserves existing copper and uses the upstream transactional router rather than invoking an unavailable native API.
- JavaScript interruption is cooperative. It can stop code at explicit `control.throwIfCancelled()` calls and at executor boundaries, but it does not claim to forcibly terminate arbitrary synchronous JavaScript.
- The updater saves supported open documents, verifies the installed entry hash and permissions, and never force-kills EasyEDA or treats `-Force` as permission to discard work.

PCB plane-only jobs should end with `runCopper()` rather than `runAll()`. This applies DRC and zone intent without launching WASM/KRT path search over a large ground net. General routing jobs still use `runAll()` and may return an applicable `partial` result when unrouted nets remain.

`extension/schematic-snapshot.ts` explicitly reads the whole schematic for module edits (the base reader otherwise uses the selection), validates removal targets before edits, and skips drawing sheets when collecting pins. The base `eda/search.ts` pin helper delegates to this addition; the selection semantics of the base schematic reader are unchanged.

Library search supports System, Recent, Personal, Project, Public (`user`), Std Edition Public (`stdPublic`), Favorite, and LCSC (`lcsc`). Omitting `libraries` searches all sections. `kind` accepts `device`, `footprint`, `panel_library`, or `all`. Each section reports results or an explicit error; an empty result is not an access failure. Search returns one result collection under `sections`, without a duplicate flattened collection.

Pass a device result's `uuid` as `part_uuid` and `libraryUuid` as `library_uuid` in schematic additions. The editor resolves the owning library before placement. Project and Standard Edition IDs are accepted. Parts are added to the schematic first; PCB import is a separate step.

For Project devices, also preserve the original `search_query`. EasyEDA 3.2.149 has a `parent_tag` failure in its device-detail lookup; placement uses the exact UUID-matched search item and linked symbol subpart instead. It never substitutes a similarly named device from another library. Searches are bounded to 100 pages of 50 results; narrow the query if the exact device is not found.

Run from the repository root:

```powershell
node --test additions/tests/regressions.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File additions/easyeda-updater/update-easyeda-copilot-fast.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File additions/easyeda-updater/run-easyeda-updater-smoke-test.ps1
```

The regression suite covers library-scope enumeration, exact library identity, project-device pagination, rollback behavior, whole-page snapshots, drawing-sheet exclusion, board cleanup retries, Apply Changes targeting, router scoping, bridge instance selection, document saving, and cooperative cancellation.

Use the workspace portable Node runtime if system Node is too old. With no package argument, the updater reads `extension/extension.json` and selects the matching package under `build/dist`; `-PackageFile` and `-PackageDir` remain available for explicit builds. The updater saves every supported open design tab, disables the old extension, reloads the saved editors, waits for the project/database, imports and enables the package, and reloads again. It verifies the installed entry-file SHA-256, manifest version, enabled state, external-interaction permission, and project bridge. It never force-kills EasyEDA. Unsupported editable tabs or failed saves stop the update. `-Force` does not bypass these checks. The old `-SkipBridgeVerification` flag is deprecated and does not skip current-protocol verification.

## Upstreaming

Keep pull requests focused, as requested by upstream `CONTRIBUTING.md`. The recommended split is project-tree null safety, linked-document board deletion, editor-library search, exact non-LCSC placement, cooperative JavaScript interruption, import confirmation, compatibility autorouting, and optional developer tooling. Generated `.eext` packages, installer backups, and project-specific board automation do not belong in upstream pull requests.
