import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { App, MarkdownView, TFile, arrayBufferToBase64 } from "obsidian";
import { reactive, ref, type Ref } from "vue";
import * as acp from "@agentclientprotocol/sdk";

import type { AgentProfile, AcpBridgeSettings } from "../settings";
import { VaultFs } from "./filesystem";
import { discoverRules, readPrimer, ruleApplies, type DiscoveredRule } from "./rules";
import type {
	ChatItem,
	ConnectionState,
	ContextRef,
	ContextRefDraft,
	Plan,
	SavedSession,
	SessionConfig,
	SessionConfigOption,
	SessionId,
	SessionModelState,
	SessionModeState,
} from "./types";

export interface AcpController {
	state: Ref<ConnectionState>;
	chatItems: ChatItem[];
	plan: Ref<Plan | null>;
	thinking: Ref<boolean>;
	sessionConfig: SessionConfig;
	contextRefs: ContextRef[];
	currentSavedId: Ref<string | null>;
	loadSessionSupported: Ref<boolean>;
	start(profile: AgentProfile): Promise<void>;
	autoStart(profile: AgentProfile): Promise<void>;
	loadSavedSession(savedId: string): Promise<void>;
	sendPrompt(text: string): Promise<void>;
	cancel(): Promise<void>;
	stop(): Promise<void>;
	resolvePermission(itemId: string, optionId: string): void;
	setConfigOption(configId: string, value: string | boolean): Promise<void>;
	setModel(modelId: string): Promise<void>;
	setMode(modeId: string): Promise<void>;
	addContextRef(ref: ContextRefDraft): void;
	removeContextRef(id: string): void;
	addImageFromVault(file: TFile): Promise<void>;
	addImageFromBlob(blob: Blob, suggestedName?: string): Promise<void>;
	addCurrentSelection(): void;
}

export function createAcpController(
	app: App,
	getSettings: () => AcpBridgeSettings,
	saveSettings: () => Promise<void>,
): AcpController {
	const state = ref<ConnectionState>({ kind: "idle" });
	const chatItems = reactive<ChatItem[]>([]);
	const plan = ref<Plan | null>(null);
	const thinking = ref(false);
	const sessionConfig = reactive<SessionConfig>({
		configOptions: [],
		models: null,
		modes: null,
	});
	const contextRefs = reactive<ContextRef[]>([]);
	const currentSavedId = ref<string | null>(null);
	const loadSessionSupported = ref<boolean>(false);

	let proc: ChildProcessWithoutNullStreams | null = null;
	let connection: acp.ClientSideConnection | null = null;
	let firstTurnSent = false;
	const permissionResolvers = new Map<string, (r: acp.RequestPermissionResponse) => void>();
	const fs = new VaultFs(app);

	async function spawnAndInitialize(profile: AgentProfile): Promise<void> {
		await stop();
		state.value = { kind: "starting" };

		const env = { ...process.env, ...profile.env };
		proc = spawn(profile.command, profile.args, {
			cwd: fs.basePath,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		proc.stderr.on("data", chunk => {
			if (getSettings().logTraffic) console.debug("[acp:stderr]", chunk.toString());
		});
		proc.on("exit", (code, signal) => {
			if (getSettings().logTraffic) {
				console.info(`[acp] agent exited (code=${code}, signal=${signal})`);
			}
			if (state.value.kind !== "error") state.value = { kind: "idle" };
			proc = null;
			connection = null;
		});
		proc.on("error", err => {
			state.value = { kind: "error", message: err.message };
		});

		const stream = acp.ndJsonStream(
			Writable.toWeb(proc.stdin) as WritableStream,
			Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>,
		);

		const clientImpl: acp.Client = {
			async requestPermission(req) {
				const auto = autoDecide(req, getSettings(), fs);
				if (auto) return auto;
				return new Promise<acp.RequestPermissionResponse>(resolve => {
					const itemId = randomId();
					permissionResolvers.set(itemId, resolve);
					chatItems.push({
						kind: "permission",
						id: itemId,
						toolCall: req.toolCall,
						options: req.options,
						outcome: { state: "pending" },
					});
				});
			},
			async sessionUpdate(notif) {
				applyUpdate(notif, { chatItems, plan, thinking, sessionConfig });
			},
			async readTextFile(req) { return fs.readTextFile(req); },
			async writeTextFile(req) { return fs.writeTextFile(req); },
		};

		connection = new acp.ClientSideConnection(() => clientImpl, stream);

		const init = await connection.initialize({
			protocolVersion: acp.PROTOCOL_VERSION,
			clientCapabilities: {
				fs: { readTextFile: true, writeTextFile: true },
			},
		});
		loadSessionSupported.value = !!init.agentCapabilities?.loadSession;
		if (getSettings().logTraffic) console.info("[acp] initialized", init);
	}

	async function start(profile: AgentProfile) {
		try {
			await spawnAndInitialize(profile);
			if (!connection) return;
			const session = await connection.newSession({
				cwd: fs.basePath,
				mcpServers: [],
			});

			sessionConfig.configOptions = (session.configOptions ?? []) as SessionConfigOption[];
			sessionConfig.models = (session.models ?? null) as SessionModelState | null;
			sessionConfig.modes = (session.modes ?? null) as SessionModeState | null;
			firstTurnSent = false;

			const saved: SavedSession = {
				id: randomId(),
				sessionId: session.sessionId,
				title: "Untitled",
				lastUsed: Date.now(),
				profileId: profile.id,
			};
			getSettings().savedSessions.unshift(saved);
			await saveSettings();
			currentSavedId.value = saved.id;

			state.value = { kind: "ready", sessionId: session.sessionId };
		} catch (err) {
			state.value = { kind: "error", message: (err as Error).message };
			await stop();
		}
	}

	async function autoStart(profile: AgentProfile) {
		const settings = getSettings();
		const candidate = settings.savedSessions
			.filter(s => s.profileId === profile.id)
			.sort((a, b) => b.lastUsed - a.lastUsed)[0];
		if (candidate) {
			await loadSavedSession(candidate.id);
			if (state.value.kind === "ready") return;
		}
		await start(profile);
	}

	async function loadSavedSession(savedId: string) {
		const settings = getSettings();
		const saved = settings.savedSessions.find(s => s.id === savedId);
		if (!saved) {
			state.value = { kind: "error", message: "Saved session not found." };
			return;
		}
		const profile = settings.profiles.find(p => p.id === saved.profileId);
		if (!profile) {
			state.value = { kind: "error", message: `Agent profile "${saved.profileId}" no longer exists.` };
			return;
		}
		try {
			await spawnAndInitialize(profile);
			if (!connection) return;
			if (!loadSessionSupported.value) {
				state.value = { kind: "error", message: "This agent doesn't support loading saved sessions." };
				await stop();
				return;
			}
			firstTurnSent = true;
			const loaded = await connection.loadSession({
				sessionId: saved.sessionId,
				cwd: fs.basePath,
				mcpServers: [],
			});
			sessionConfig.configOptions = (loaded?.configOptions ?? []) as SessionConfigOption[];
			sessionConfig.models = (loaded?.models ?? null) as SessionModelState | null;
			sessionConfig.modes = (loaded?.modes ?? null) as SessionModeState | null;
			saved.lastUsed = Date.now();
			await saveSettings();
			currentSavedId.value = saved.id;
			state.value = { kind: "ready", sessionId: saved.sessionId };
		} catch (err) {
			state.value = { kind: "error", message: (err as Error).message };
			await stop();
		}
	}

	async function sendPrompt(text: string) {
		if (state.value.kind !== "ready" || !connection) {
			throw new Error("Not connected to an agent.");
		}
		const sessionId = state.value.sessionId;
		const settingsNow = getSettings();

		chatItems.push({
			kind: "message",
			id: randomId(),
			role: "user",
			chunks: [{ type: "text", text }],
		});

		const blocks: acp.ContentBlock[] = [];
		if (!firstTurnSent) {
			blocks.push({ type: "text", text: buildIntro(app, fs.basePath) });
			firstTurnSent = true;
		}

		const activeFile = app.workspace.getActiveFile();
		const candidatePaths: (string | null)[] = [activeFile?.path ?? null];
		for (const r of contextRefs) {
			if (r.kind === "file" || r.kind === "folder") candidatePaths.push(r.path);
		}
		const rulesText = await buildRulesBlock(app, settingsNow.ruleFiles, candidatePaths);
		if (rulesText) blocks.push({ type: "text", text: rulesText });

		const hasAgentEffort = sessionConfig.configOptions.some(o => o.category === "thought_level");
		const ctxText = buildContext(
			app,
			fs.basePath,
			contextRefs,
			activeFile?.path ?? null,
			hasAgentEffort ? null : settingsNow.effort,
		);
		blocks.push({ type: "text", text: ctxText });

		if (activeFile) {
			blocks.push(fileResourceLink(fs.basePath, activeFile.path, activeFile.name));
		}
		for (const ref of contextRefs) {
			if (ref.kind === "file") {
				blocks.push(fileResourceLink(fs.basePath, ref.path, ref.name));
			} else if (ref.kind === "image") {
				blocks.push({ type: "image", data: ref.data, mimeType: ref.mimeType });
			} else if (ref.kind === "selection") {
				const where = ref.sourcePath ? ` (from ${ref.sourcePath})` : "";
				blocks.push({ type: "text", text: `[Attached selection${where}]\n\`\`\`\n${ref.text}\n\`\`\`` });
			}
		}

		blocks.push({ type: "text", text });

		const saved = currentSavedId.value
			? settingsNow.savedSessions.find(s => s.id === currentSavedId.value)
			: undefined;
		if (saved) {
			if (saved.title === "Untitled") {
				saved.title = text.slice(0, 60).replace(/\s+/g, " ").trim() || saved.title;
			}
			saved.lastUsed = Date.now();
			void saveSettings();
		}

		thinking.value = true;
		try {
			await connection.prompt({ sessionId, prompt: blocks });
		} finally {
			thinking.value = false;
		}
	}

	async function cancel() {
		if (state.value.kind !== "ready" || !connection) return;
		await connection.cancel({ sessionId: state.value.sessionId });
	}

	async function stop() {
		try { proc?.kill(); } catch { /* noop */ }
		for (const resolve of permissionResolvers.values()) {
			resolve({ outcome: { outcome: "cancelled" } });
		}
		permissionResolvers.clear();
		proc = null;
		connection = null;
		state.value = { kind: "idle" };
		chatItems.splice(0);
		plan.value = null;
		thinking.value = false;
		sessionConfig.configOptions = [];
		sessionConfig.models = null;
		sessionConfig.modes = null;
		firstTurnSent = false;
		currentSavedId.value = null;
		loadSessionSupported.value = false;
	}

	function resolvePermission(itemId: string, optionId: string) {
		const item = chatItems.find(i => i.id === itemId);
		if (!item || item.kind !== "permission") return;
		const resolve = permissionResolvers.get(itemId);
		if (!resolve) return;
		const opt = item.options.find(o => o.optionId === optionId);
		item.outcome = { state: "decided", optionId, optionName: opt?.name ?? optionId };
		permissionResolvers.delete(itemId);
		resolve({ outcome: { outcome: "selected", optionId } });
	}

	async function setConfigOption(configId: string, value: string | boolean) {
		if (state.value.kind !== "ready" || !connection) return;
		const base = { sessionId: state.value.sessionId, configId };
		const req = typeof value === "boolean"
			? { ...base, type: "boolean" as const, value }
			: { ...base, value };
		const res = await connection.setSessionConfigOption(req);
		if (res?.configOptions) {
			sessionConfig.configOptions = res.configOptions as SessionConfigOption[];
		} else {
			const opt = sessionConfig.configOptions.find(o => o.id === configId);
			if (opt) (opt as { currentValue: string | boolean }).currentValue = value;
		}
	}

	async function setModel(modelId: string) {
		if (state.value.kind !== "ready" || !connection) return;
		await connection.unstable_setSessionModel({
			sessionId: state.value.sessionId,
			modelId,
		});
		if (sessionConfig.models) sessionConfig.models.currentModelId = modelId;
	}

	async function setMode(modeId: string) {
		if (state.value.kind !== "ready" || !connection) return;
		await connection.setSessionMode({
			sessionId: state.value.sessionId,
			modeId,
		});
		if (sessionConfig.modes) sessionConfig.modes.currentModeId = modeId;
	}

	function addContextRef(ref: ContextRefDraft) {
		if (ref.kind === "file" || ref.kind === "folder") {
			if (contextRefs.some(r => r.kind === ref.kind && r.path === ref.path)) return;
		}
		contextRefs.push({ ...ref, id: randomId() });
	}

	function removeContextRef(id: string) {
		const i = contextRefs.findIndex(r => r.id === id);
		if (i >= 0) contextRefs.splice(i, 1);
	}

	async function addImageFromVault(file: TFile) {
		const buf = await app.vault.readBinary(file);
		contextRefs.push({
			id: randomId(),
			kind: "image",
			name: file.name,
			mimeType: mimeForExt(file.extension) ?? "application/octet-stream",
			data: arrayBufferToBase64(buf),
		});
	}

	async function addImageFromBlob(blob: Blob, suggestedName?: string) {
		const buf = await blob.arrayBuffer();
		const ext = (blob.type.split("/")[1] ?? "png").split("+")[0];
		contextRefs.push({
			id: randomId(),
			kind: "image",
			name: suggestedName ?? `pasted-${Date.now()}.${ext}`,
			mimeType: blob.type || "image/png",
			data: arrayBufferToBase64(buf),
		});
	}

	function addCurrentSelection() {
		const md = app.workspace.getActiveViewOfType(MarkdownView);
		const sel = md?.editor?.getSelection() ?? "";
		if (!sel.trim()) return;
		const file = app.workspace.getActiveFile();
		const preview = sel.slice(0, 40).replace(/\s+/g, " ").trim();
		contextRefs.push({
			id: randomId(),
			kind: "selection",
			name: preview.length > 0 ? `"${preview}${sel.length > 40 ? "…" : ""}"` : "(selection)",
			text: sel,
			sourcePath: file?.path ?? null,
		});
	}

	return {
		state,
		chatItems,
		plan,
		thinking,
		sessionConfig,
		contextRefs,
		currentSavedId,
		loadSessionSupported,
		start,
		autoStart,
		loadSavedSession,
		sendPrompt,
		cancel,
		stop,
		resolvePermission,
		setConfigOption,
		setModel,
		setMode,
		addContextRef,
		removeContextRef,
		addImageFromVault,
		addImageFromBlob,
		addCurrentSelection,
	};
}

async function buildRulesBlock(
	app: App,
	manualPaths: string[],
	candidatePaths: (string | null)[],
): Promise<string | null> {
	const parts: string[] = [];
	const seen = new Set<string>();

	const primer = await readPrimer(app);
	if (primer) {
		parts.push(`# ${primer.path} (primer)`);
		parts.push(primer.body);
		seen.add(primer.path);
	}

	const discovered = await discoverRules(app);
	for (const rule of discovered) {
		if (seen.has(rule.path)) continue;
		if (!ruleApplies(rule, candidatePaths)) continue;
		const scope = rule.pathGlobs.length ? ` (scoped: ${rule.pathGlobs.join(", ")})` : "";
		parts.push(`# ${rule.path}${scope}`);
		parts.push(rule.body);
		seen.add(rule.path);
	}

	for (const p of manualPaths) {
		if (seen.has(p)) continue;
		const file = app.vault.getFileByPath(p);
		if (!file) continue;
		const text = await app.vault.cachedRead(file);
		parts.push(`# ${p}`);
		parts.push(text);
		seen.add(p);
	}

	if (parts.length === 0) return null;
	return ["[Rules — always-on instructions from the user]", ...parts].join("\n\n");
}

function mimeForExt(ext: string): string | null {
	const e = ext.toLowerCase();
	if (e === "png") return "image/png";
	if (e === "jpg" || e === "jpeg") return "image/jpeg";
	if (e === "gif") return "image/gif";
	if (e === "webp") return "image/webp";
	if (e === "svg") return "image/svg+xml";
	if (e === "bmp") return "image/bmp";
	return null;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
export function isImageFile(file: TFile): boolean {
	return IMAGE_EXTS.has(file.extension.toLowerCase());
}

function autoDecide(
	req: acp.RequestPermissionRequest,
	settings: AcpBridgeSettings,
	fs: VaultFs,
): acp.RequestPermissionResponse | null {
	const allowOpt = req.options.find(o => o.kind === "allow_once" || o.kind === "allow_always");
	if (!allowOpt) return null;
	const kind = req.toolCall.kind;
	if (settings.autoApproveReads && kind === "read") {
		return { outcome: { outcome: "selected", optionId: allowOpt.optionId } };
	}
	if (settings.autoApproveWritesInsideVault && kind === "edit") {
		const insideVault = (req.toolCall.locations ?? []).every(l => fs.isInsideVault(l.path));
		if (insideVault) return { outcome: { outcome: "selected", optionId: allowOpt.optionId } };
	}
	return null;
}

interface UpdateSinks {
	chatItems: ChatItem[];
	plan: Ref<Plan | null>;
	thinking: Ref<boolean>;
	sessionConfig: SessionConfig;
}

function applyUpdate(notif: acp.SessionNotification, sinks: UpdateSinks) {
	const u = notif.update;
	switch (u.sessionUpdate) {
		case "agent_message_chunk":
			appendMessageChunk(sinks.chatItems, "agent", u.content);
			break;
		case "agent_thought_chunk":
			appendMessageChunk(sinks.chatItems, "thought", u.content);
			break;
		case "user_message_chunk":
			appendMessageChunk(sinks.chatItems, "user", u.content);
			break;
		case "tool_call":
			sinks.chatItems.push({
				kind: "tool_call",
				id: randomId(),
				toolCallId: u.toolCallId,
				title: u.title,
				toolKind: u.kind ?? "other",
				status: u.status ?? "pending",
				rawInput: u.rawInput,
				content: u.content ?? [],
				locations: u.locations,
			});
			break;
		case "tool_call_update": {
			const tc = sinks.chatItems.find(
				i => i.kind === "tool_call" && i.toolCallId === u.toolCallId,
			) as Extract<ChatItem, { kind: "tool_call" }> | undefined;
			if (!tc) break;
			if (u.status) tc.status = u.status;
			if (u.title) tc.title = u.title;
			if (u.content) tc.content = u.content;
			if (u.locations) tc.locations = u.locations;
			if (u.rawInput !== undefined) tc.rawInput = u.rawInput;
			break;
		}
		case "plan":
			sinks.plan.value = { entries: u.entries };
			break;
		case "current_mode_update":
			if (sinks.sessionConfig.modes) sinks.sessionConfig.modes.currentModeId = u.currentModeId;
			break;
		case "config_option_update":
			sinks.sessionConfig.configOptions = u.configOptions as SessionConfigOption[];
			break;
		default:
			break;
	}
}

function appendMessageChunk(items: ChatItem[], role: "user" | "agent" | "thought", chunk: acp.ContentBlock) {
	const last = items[items.length - 1];
	if (last && last.kind === "message" && last.role === role) {
		last.chunks.push(chunk);
		return;
	}
	items.push({ kind: "message", id: randomId(), role, chunks: [chunk] });
}

function buildIntro(_app: App, vaultPath: string): string {
	return [
		"You are talking to a user inside Obsidian, a Markdown-based note-taking app.",
		`The user's vault (a folder of Markdown notes) is at \`${vaultPath}\`.`,
		"Notes can use [[wikilinks]] to other notes and #tags. File-system requests you make read and write inside this vault.",
		"The user sees your replies in a chat panel inside Obsidian, alongside their notes. Keep responses focused; the panel is narrow.",
	].join("\n");
}

function buildContext(
	app: App,
	vaultPath: string,
	refs: ContextRef[],
	activePath: string | null,
	effort: string | null,
): string {
	const md = app.workspace.getActiveViewOfType(MarkdownView);
	const lines: string[] = ["[Obsidian context]", `Vault path: ${vaultPath}`];
	if (activePath) {
		lines.push(`Active file: ${activePath}`);
		const sel = md?.editor?.getSelection();
		if (sel && sel.length > 0) {
			lines.push("Selection:");
			lines.push("```");
			lines.push(sel);
			lines.push("```");
		}
	} else {
		lines.push("Active file: (none)");
	}
	const folders = refs.filter(r => r.kind === "folder");
	const files = refs.filter(r => r.kind === "file");
	if (folders.length) {
		lines.push("Attached folders (the user wants you to consider these):");
		for (const f of folders) lines.push(`  - ${f.path}/`);
	}
	if (files.length) {
		lines.push("Attached files (links follow as resource_link blocks):");
		for (const f of files) lines.push(`  - ${f.path}`);
	}
	if (effort) {
		lines.push(`Reasoning effort the user wants: ${effort} (use minimal thinking for trivial requests, more for complex tasks).`);
	}
	return lines.join("\n");
}

function fileResourceLink(vaultPath: string, relPath: string, name: string): acp.ContentBlock {
	const abs = `${vaultPath}/${relPath}`;
	const uri = "file://" + abs.split("/").map(encodeURIComponent).join("/");
	const ext = relPath.split(".").pop()?.toLowerCase();
	const mimeType = ext === "md" ? "text/markdown"
		: ext === "json" ? "application/json"
		: ext === "txt" ? "text/plain"
		: undefined;
	return { type: "resource_link", name, uri, mimeType };
}

function randomId(): string {
	return crypto.randomUUID();
}
