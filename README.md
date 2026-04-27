# copilot-api (DEPRECATED — use copilot-bridge)

> [!IMPORTANT]
> **This repository is no longer maintained.**
> Active development has moved to [**`copilot-bridge`**](https://github.com/betaHi/copilot-bridge),
> which supports both **Codex CLI** and **Claude Code** out of the box.

## What's new in copilot-bridge

- **Codex CLI** support (auto-writes `~/.codex/config.toml`)
- **Claude Code** support (no flags needed)
- [Usage Viewer](https://betahi.github.io/copilot-api?endpoint=http://127.0.0.1:4242/usage), CORS, rate limiting
- End-to-end tested with the real Codex / Claude CLIs

## Migration

Replace any old commands:

```sh
# old
npx betahi-copilot-api@latest start

# new
npx betahi-copilot-bridge@latest start
```

For Claude Code, set `ANTHROPIC_BASE_URL` to the bridge port (default `4142`)
in `~/.claude/settings.json`. For Codex CLI, just run `start` once — the bridge
writes a managed block into `~/.codex/config.toml` for you.

See the new README: <https://github.com/betaHi/copilot-bridge#readme>

## Archive

The original README has been preserved as
[`README_DEPRECATED.md`](./README_DEPRECATED.md) for reference.
