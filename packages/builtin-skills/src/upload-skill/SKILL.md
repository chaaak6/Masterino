---
name: upload-skill
description: Submit a finished personal or current-project skill for internal community review when the user asks to share or upload it.
---

# Submit a skill for review

Use `lobe-skill-authoring.submitSkill`. For a current-project skill pass its directory name; for a personal library skill pass its exact skill ID or identifier from the skill library. Never invent an ID or choose an ambiguous source. Read the selected skill and its resource list first and explain what will be shared. Submit only when the user asks to share it. Validation and submission do not run bundled scripts.

A successful tool result reports the actual workflowState/status and resource/version IDs. Say submitted for review, not published. Repeating the same submission is safe. If the original changes, send a new snapshot and preserve the old revision for review. Keep local originals. If the device is offline, report the failure and retry only after it reconnects. Never approve or publish a resource yourself.
