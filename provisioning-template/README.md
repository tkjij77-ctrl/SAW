---
title: Minecraft Server Agent
emoji: 🎮
colorFrom: green
colorTo: blue
sdk: gradio
sdk_version: 5.29.0
python_version: "3.12"
app_file: app.py
pinned: false
tags:
  - minecraft
  - mc-panel-agent
---

# Minecraft Server Agent

Minecraft/Purpur agent controlled by MC Control Cloud.

Features:

- Java + Bedrock crossplay through Geyser and Floodgate.
- Multi-version Java support through ViaVersion, ViaBackwards and ViaRewind.
- Secure Java authentication (`online-mode=true`).
- Dirty-aware Dataset snapshots every 60 minutes and before restart.
- Automatic restore of the latest verified snapshot when a fresh Space disk is detected.
- Resumable chunked uploads up to 512 MB with per-chunk and final SHA-256 verification.
- Atomic Safe Apply: stop, backup old file, write, read-back SHA-256 verify, Dataset snapshot, restart, and rollback on any failure.
- Automatic safe handoff from the TCP-only Playit Minecraft plugin to the official TCP/UDP Program Agent after the first claim.
- Geyser Bedrock listener on UDP `19132` with background, readiness-aware and idempotent creation of both `minecraft-java` and `minecraft-bedrock` tunnels; Dashboard remains a fallback.

Recommended variables: `ACCEPT_EULA=true`, `INSTALL_CROSSPLAY=true`, `INSTALL_VIA_SUITE=true`.

Named API endpoints:

- `/server_status`
- `/server_logs`
- `/server_resources`
- `/server_players`
- `/start_server`
- `/stop_server`
- `/restart_server`
- `/send_command`
- `/files_list`
- `/file_read`
- `/file_write`
- `/file_upload`, `/file_download`, `/file_create`, `/file_rename`, `/file_delete`
- `/backup_list`, `/backup_create`, `/backup_status`, `/backup_delete`, `/backup_restore`
- `/plugin_install` (verified Modrinth CDN + SHA-512)

Dataset backups require the private Space secret `HF_TOKEN` and variable `DATASET_REPO_ID`. Auto-provisioned SAW beta.7 servers configure both automatically.
