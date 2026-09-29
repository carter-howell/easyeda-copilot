# EasyEDA project protection

`protect-and-switch.ps1` creates a dated, hashed backup of the EasyEDA configuration, local projects, online-project backups, and recovery projects. It can then switch the desktop client to Half-Offline mode so local projects remain available without signing in.

Run a backup at any time:

```powershell
.\additions\easyeda-project-protection\protect-and-switch.ps1 -Mode BackupOnly
```

After closing EasyEDA normally, back up and switch modes:

```powershell
.\additions\easyeda-project-protection\protect-and-switch.ps1 -Mode HalfOffline
```

The mode switch refuses to run while EasyEDA is open. Backups are stored in `project-safety-backups` beside the repository, outside Git.
