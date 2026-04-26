# ACP Bridge for Obsidian

Talk to [ACP](https://agentclientprotocol.com)-compatible coding agents — Claude Code, Gemini CLI, Codex, and others — from inside Obsidian. The agent runs locally as a subprocess and can read and edit files in your vault, with per-call permission prompts.

> **Status: alpha — v0.1.0.** Desktop-only. APIs around it are still moving fast; expect rough edges.

> **A note on provenance.** Most of this code was written by Claude Opus in conversational pair-programming sessions, with a human at the wheel — reviewing every diff, running every build, and making the architectural calls. The human is enthusiastic, not an Obsidian-plugin veteran. The plugin is alpha; the agent you point it at can read and write files in your vault. Treat it accordingly: try it on a vault you don't mind losing first, skim the source if you're trusting it with anything sensitive, and report bugs cheerfully. There is, in the spirit of the genre, no warranty.

## What it does

- Spawns a local ACP agent (default: `npx -y @zed-industries/claude-code-acp`) and connects over stdio.
- Adds a chat view (right sidebar by default; ribbon icon + command palette: "ACP Bridge: Open chat").
- Lets the agent read and write files **inside your vault** via ACP's `fs/*` methods.
- Asks for permission before tool calls. File reads can be auto-approved in settings.
- Surfaces tool calls, plans, and thoughts in the chat panel.

## Install (manual, dev)

This is not on the community plugin catalog yet. To run locally:

```bash
git clone <this-repo> obsidian-acp-bridge
cd obsidian-acp-bridge
npm install
npm run build
```

Then copy or symlink the plugin into your test vault:

```bash
ln -s "$PWD" "/path/to/your/vault/.obsidian/plugins/acp-bridge"
```

The folder name inside `.obsidian/plugins/` **must equal `acp-bridge`** (the `id` in `manifest.json`).

In Obsidian: **Settings → Community plugins → Installed plugins → ACP Bridge → enable**. Install the community **Hot Reload** plugin in your vault to get auto-reload during development.

## Configure

**Settings → Community plugins → ACP Bridge:**

- **Active profile** — which configured agent to launch.
- **Command / Arguments** — executable + args for the active profile. Defaults to `npx -y @zed-industries/claude-code-acp`. You'll need an `ANTHROPIC_API_KEY` in your environment for that one to work.
- **Auto-approve file reads** — on by default; reads inside the vault won't prompt.
- **Auto-approve writes inside the vault** — off by default; every write asks.
- **Log JSON-RPC traffic to console** — off; turn on when an agent does something unexpected.

## Use

1. Open the chat panel (ribbon icon, or command "ACP Bridge: Open chat").
2. Click **Start** in the panel header (or run command "ACP Bridge: Start agent session").
3. Type a message, **Cmd/Ctrl+Enter** to send.
4. Approve or reject any tool calls the agent requests.
5. Click **Cancel turn** to interrupt the agent mid-stream; **Stop** to kill the agent.

## Limitations (v0.1)

- Desktop only (subprocess required; ACP-over-WebSocket isn't ready in the spec).
- One session at a time.
- One agent profile editable in the UI (the settings shape supports more — UI to add/remove profiles is pending).
- No terminal support.
- No MCP forwarding — Obsidian doesn't pass any MCP servers to the agent yet.
- Plain-text rendering of agent output. No Markdown/syntax highlighting yet.
- Mobile content blocks (image, audio, resource) show as `[<type>]` placeholders.

## Security model

- The agent runs with your user's permissions. **Don't run an agent you don't trust.**
- File access is restricted to the vault root via path normalization. Paths outside the vault are rejected by the client.
- Writes default to prompting on every call. Auto-approval is opt-in per category.
- The plugin makes no network requests of its own; the agent may.

## License

MIT. See `LICENSE`.
