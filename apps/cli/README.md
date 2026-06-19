# MasterLion CLI

MasterLion command-line interface for local development, automation, and server interaction.

The executable names currently remain `lh`, `lobe`, and `lobehub` for compatibility with the upstream CLI packaging. Treat those command names as compatibility aliases, not user-facing product names.

## Local Development

| Task | Command |
| --- | --- |
| Run in dev mode | `bun run dev -- <command>` |
| Build the CLI | `bun run build` |
| Link CLI aliases into your shell | `bun run cli:link` |
| Remove the global link | `bun run cli:unlink` |

- `bun run build` only generates `dist/index.js`.
- To make `lh` available in your shell, run `bun run cli:link`.
- After linking, if your shell still cannot find `lh`, run `rehash` in `zsh`.

## Custom Server URL

By default the CLI connects to `https://aihub.bielcrystal.com`. To point it at a different server, such as a local MasterLion instance:

| Method | Command | Persistence |
| --- | --- | --- |
| Environment variable | `LOBEHUB_SERVER=http://localhost:4000 bun run dev -- <command>` | Current command only |
| Login flag | `lh login --server http://localhost:4000` | Saved to `~/.lobehub/settings.json` |

Compatibility settings still use the legacy `LOBEHUB_SERVER` variable and `~/.lobehub/settings.json` path. Do not rename them without reviewing CLI storage and migration impact.

Priority: `LOBEHUB_SERVER` env var > `settings.json` > default Aihub URL.

## Shell Completion

### Install completion for a linked CLI

| Shell | Command |
| --- | --- |
| `zsh` | `source <(lh completion zsh)` |
| `bash` | `source <(lh completion bash)` |

### Use completion during local development

| Shell | Command |
| --- | --- |
| `zsh` | `source <(bun src/index.ts completion zsh)` |
| `bash` | `source <(bun src/index.ts completion bash)` |

- Completion is context-aware. For example, `lh agent <Tab>` shows agent subcommands instead of top-level commands.
- If you update completion logic locally, re-run the corresponding `source <(...)` command to reload it in the current shell session.
- Completion only registers shell functions. It does not install the `lh` binary by itself.

## Quick Check

```bash
which lh
lh --help
lh agent <TAB>
```
