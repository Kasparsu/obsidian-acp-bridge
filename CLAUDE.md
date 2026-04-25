# obsidian-acp-bridge

Obsidian plugin that lets users talk to ACP-compatible coding agents (Claude Code, Gemini CLI, Codex, …) from inside Obsidian. Obsidian acts as the **client**; the agent runs as a local subprocess and communicates over JSON-RPC on stdio per the [Agent Client Protocol](https://agentclientprotocol.com).

For Obsidian-platform mechanics (lifecycle, manifest, vault APIs, build, release), see the global `obsidian-plugin` skill at `~/.claude/skills/obsidian-plugin/`. This file covers ACP-side concerns specific to this project.

## Architecture

```
+--------------------+        spawn (stdio)       +-----------------+
|  Obsidian (this)   |  <----------------------->  |  ACP agent       |
|  ACP Bridge plugin |     JSON-RPC newline-delim |  (subprocess)    |
+--------------------+                            +-----------------+
        |
        +-- ChatView (ItemView)  ── mounts Vue 3 app
        +-- AcpController        ── owns the connection + reactive state
        +-- VaultFs              ── fs/* method handlers
```

`src/main.ts` is lifecycle only. The real work happens inside `AcpController` (`src/acp/client.ts`), which:
- Spawns the agent subprocess with the active profile's command/args
- Wraps `acp.ClientSideConnection` from `@agentclientprotocol/sdk` (v0.20)
- Implements the `acp.Client` interface — receives `sessionUpdate` notifications and `requestPermission`/`readTextFile`/`writeTextFile` requests
- Exposes Vue-reactive state consumed by the chat UI via `inject('controller')`:
  - `chatItems[]` — unified discriminated union: `message`, `tool_call`, `permission`. Tool calls and permission prompts render **inline in the chat flow**, not in a side panel or modal.
  - `plan` — current plan (separate from chat; rendered in header)
  - `sessionConfig` — `{ configOptions, models, modes }` exposed by the agent at session start
  - `state` — connection lifecycle
  - `thinking` — true while a turn is in flight

## ACP protocol orientation

Read the local clones if you need detail:

- Spec docs: `/tmp/obsidian-research/acp/docs/protocol/` (initialization, prompt-turn, tool-calls, file-system, terminals, slash-commands, sessions, content)
- Reference impls: `/tmp/acp-ts-sdk/src/examples/{client,agent}.ts`
- TypeScript SDK source: `/tmp/acp-ts-sdk/src/acp.ts` — exports `Client`, `Agent`, `ClientSideConnection`, `AgentSideConnection`, `ndJsonStream`, `PROTOCOL_VERSION`

If `/tmp` is gone, re-clone:
```bash
git clone --depth 1 https://github.com/agentclientprotocol/agent-client-protocol.git /tmp/obsidian-research/acp
git clone --depth 1 https://github.com/agentclientprotocol/typescript-sdk.git /tmp/acp-ts-sdk
```

## Lifecycle

1. `initialize` — handshake. We advertise `fs.{readTextFile, writeTextFile}: true` and let the agent declare its capabilities (loadSession, promptCapabilities, etc.).
2. `session/new` — opens a session with `cwd` (vault root) and `mcpServers` (none in v0.1).
3. `session/prompt` — user sends text; agent streams `session/update` notifications until the turn stops with a `stopReason` (`end_turn`, `cancelled`, `tool_use`, etc.).
4. During a turn the agent may call `fs/read_text_file`, `fs/write_text_file`, `session/request_permission`, `terminal/*` (we don't implement terminals yet).

## Session updates we render

`agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk` → message chat items. `tool_call` / `tool_call_update` → tool_call chat items (inline; expandable cards). `plan` → header banner. `current_mode_update` / `config_option_update` → updates `sessionConfig` so the header dropdowns stay in sync if the agent flips modes mid-turn. `available_commands_update`, `session_info_update`, `usage_update` are dropped — wire them in `client.ts:applyUpdate` if a feature needs them.

## Prompt context injection

Every prompt sent via `controller.sendPrompt(text)` becomes a multi-block ACP prompt:
- **First turn of a session only**: a brief "you're in Obsidian" intro text block (`buildIntro` in `client.ts`).
- **Every prompt**: an `[Obsidian context]` text block with the vault path, currently active file, and current selection if any (`buildContext`).
- The user's text as the final block.

The agent receives these as plain content blocks; it doesn't need to know the difference. This is how the agent learns what file the user is looking at, so it can give grounded answers without us forcing it to call `fs/read_text_file` first.

If the user complains about leaked context for sensitive prompts, expose a per-prompt toggle. Don't blanket-disable — the context is what makes the chat feel like an Obsidian feature instead of a generic LLM box.

## File-system safety

`VaultFs.toVaultRel` rejects any path that isn't inside the vault. The agent can be given absolute paths (it will receive `cwd = vault base path` in `session/new`) and we translate back to vault-relative for `app.vault.*` calls. **Never bypass this check** — letting an agent read/write outside the vault is a hard rule break for an Obsidian plugin per the developer policies.

`writeTextFile` uses `app.vault.process` for atomic edits when the file already exists; `app.vault.create` otherwise (creating intermediate folders if needed).

## Permission model

- `autoApproveReads` (default ON) silently allows `kind: "read"` tool calls. The agent's `requestPermission` returns immediately without touching the chat.
- `autoApproveWritesInsideVault` (default OFF) auto-allows `kind: "edit"` only when **all** declared `locations` are inside the vault.
- Anything else: a `permission` chat item is appended to `chatItems` with the request payload + the user's options. The pending Promise is held in `permissionResolvers: Map<itemId, fn>`. When the user clicks an option button, `controller.resolvePermission(itemId, optionId)` resolves the promise with `outcome: { outcome: "selected", optionId }` and marks the chat item `decided`.
- If the controller stops mid-prompt with pending permissions, every resolver is called with `outcome: { outcome: "cancelled" }` so the agent isn't left hanging.

Why inline, not a modal? Modals interrupt the user's flow and lose context (you can't see what the agent was about to do alongside what it already said). Inline cards keep the chronology intact and let the user scroll back later to audit decisions.

When in doubt, prompt. Quietly approving destructive operations is the failure mode users complain about.

## Session config (model / mode / effort)

After `newSession`, the agent may report:
- `configOptions: SessionConfigOption[]` — the new ACP umbrella for everything (`category: "model" | "mode" | "thought_level" | string`). Preferred.
- `models: SessionModelState` — older model-specific listing.
- `modes: SessionModeState` — older mode-specific listing.

The `SessionConfigBar` in the header renders selectors for **each** `configOption` (select or boolean). It also renders fallback selectors for `models`/`modes` only when the agent didn't already cover those categories via `configOptions` — this prevents duplicate UI for agents that expose both for backwards compat.

Setters:
- `controller.setConfigOption(configId, value)` → `session/set_config_option` (handles both string-select and boolean values).
- `controller.setModel(modelId)` → `session/set_model` (unstable, but the only path for legacy agents).
- `controller.setMode(modeId)` → `session/set_mode` (deprecated; same reason).

`current_mode_update` and `config_option_update` from the agent feed back into `sessionConfig` so external changes (e.g. agent autoswitches mode) reflect in the UI.

## Subprocess hygiene

`AcpController.start` always calls `stop()` first to avoid orphans. `onunload` calls `stop()`. The child is killed (default SIGTERM) when stopped.

If you add long-running children later (terminals), add a `closeAll` for those too — Obsidian's reload doesn't re-attach to PIDs so leaks accumulate fast during dev.

## Build

```bash
npm install        # first time
npm run dev        # watch — writes main.js
npm run build      # type-check (vue-tsc) + production bundle
```

esbuild bundles Vue + ACP SDK into `main.js`. Vue runtime adds ~30 KB. The Vue compiler is invoked via `esbuild-plugin-vue3` for `.vue` SFCs. CodeMirror packages stay external (Obsidian provides them).

## Vue + Obsidian integration

- `ChatView` (an `ItemView`) creates a Vue app on `onOpen`, unmounts on `onClose`. The plugin and controller are passed via `app.provide(...)`; components grab them via `useController()` / `usePlugin()` composables.
- All reactivity lives on the controller (Vue `ref`/`reactive`). Components are stateless except for local UI state (input draft, scroll position).
- Avoid Vue's option `<style scoped>` — the bundler doesn't extract those into Obsidian's `styles.css`. Put styles in `styles.css` keyed by `acp-` class names.

## Things deliberately not in v0.1

- Multiple concurrent sessions (controller hardcodes one)
- Multiple agent profiles UI (settings supports the data shape but doesn't have add/remove yet)
- Slash commands surfacing (`available_commands_update` is dropped)
- Terminal capability
- MCP server forwarding (we send `mcpServers: []`)
- Markdown rendering of agent messages (we render plain text — wire `MarkdownRenderer.render` next)
- Image / audio / resource content blocks (we show `[<type>]` placeholders)
- Per-prompt context-injection toggle (always on)
- Mobile (impossible — needs subprocess)

When building any of these, add a section here describing the design choice so future work can pick it up.
