# Projects and schematic pages

EasyEDA tools act on a connected project and the currently opened document.

## Project selection

Use `get_all_projects` when the target project UUID is unknown. It returns an array of team nodes, each with nested `folders` and `projects`. Personal projects are represented by EasyEDA as a team too.

Project creation through `create_doc` is experimental because EasyEDA's underlying `createProject` API is beta. It creates a project but does not open it:

```json
{
  "doc": {
    "doc_type": "project",
    "project_friendly_name": "RP2040 Sensor Board",
    "project_name": "rp2040-sensor-board",
    "team_uuid": "OPTIONAL_TEAM_UUID",
    "folder_uuid": "OPTIONAL_FOLDER_UUID",
    "description": "Optional project description"
  }
}
```

Omit `project_name` to let EasyEDA generate it. Omit `team_uuid` for a personal project; `folder_uuid` and `description` are optional. To continue in the new project, explicitly call `open_document` with the returned UUID:

```json
{
  "project_uuid": "PROJECT_UUID"
}
```

Before switching projects, `open_document` saves every open schematic, PCB, and panel tab. The switch is aborted if any document cannot be saved. Use `save_doc` to save only the currently active document. After switching, wait for EasyEDA to finish and call `get_current_project_info`; do not assume that a document is open.

## Functional pages

New or substantially expanded schematics must be divided into functional pages such as `Power`, `MCU`, `USB`, `Sensors`, or `MotorDriver`.

- Keep one coherent subsystem on each page.
- Keep an IC with its local decoupling and closely related support components.
- Split a page when it contains independent functions or is no longer easy to understand.
- Do not create one page per small IC or passive network.
- Use stable, explicit signal names across pages. Do not add unused future signals.
- Do not silently reorganize a user's existing schematic during a small unrelated edit.

## Tools

1. If needed, use `get_all_projects` and `open_document({ project_uuid })` to select the project, then call `get_current_project_info` to find schematic and page UUIDs.
2. Use `create_doc({ doc: { doc_type: "schematic" } })` only when a schematic does not exist.
3. Use `create_doc({ doc: { doc_type: "schematic_page", schematic_uuid } })` for each additional functional page.
4. Give each page a short functional name with `modify_name`.
5. Call `open_document` with the target page UUID before reading or modifying it.

`delete_doc` is destructive. Use it only when deletion is explicitly requested and the exact target was verified.

Deleting a board by name preserves its linked schematic and PCB documents by default and removes only the board container/association:

```json
{
  "doc": {
    "board_name": "TemporaryBoard"
  }
}
```

To permanently delete the board container and both linked documents, the caller must explicitly opt in:

```json
{
  "doc": {
    "board_name": "TemporaryBoard",
    "delete_linked_documents": true
  }
}
```

The cascading form deletes the linked schematic and PCB first, verifies that each is absent from the EasyEDA inventory, and deletes the board container only after both child deletions succeed. EasyEDA may automatically remove the empty board after its final linked document is deleted. A partial failure leaves the board container in place so cleanup can be inspected and retried.
