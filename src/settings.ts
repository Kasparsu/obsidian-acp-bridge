import { App, Notice, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";
import type AcpBridgePlugin from "./main";
import type { SavedSession } from "./acp/types";
import { VaultItemPicker } from "./ui/modals/VaultItemPicker";

export interface ProfileTemplate {
	name: string;
	command: string;
	args: string[];
	hint?: string;
}

export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
	"claude-code": {
		name: "Claude Code",
		command: "npx",
		args: ["-y", "@zed-industries/claude-code-acp"],
		hint: "Wraps the Claude Code CLI. Logs in via your existing claude-code session or ANTHROPIC_API_KEY.",
	},
	"claude-agent": {
		name: "Claude Agent (SDK)",
		command: "npx",
		args: ["-y", "@zed-industries/claude-agent-acp"],
		hint: "Anthropic-blessed adapter built on the Claude Agent SDK. Needs ANTHROPIC_API_KEY.",
	},
	"gemini": {
		name: "Gemini CLI",
		command: "npx",
		args: ["-y", "@google/gemini-cli", "--experimental-acp"],
		hint: "Google's Gemini CLI. May need GEMINI_API_KEY or `gcloud auth login`.",
	},
	"codex": {
		name: "OpenAI Codex",
		command: "npx",
		args: ["-y", "@zed-industries/codex-acp"],
		hint: "Adapter for OpenAI's Codex CLI. Needs OPENAI_API_KEY (or your codex CLI auth).",
	},
	"cursor": {
		name: "Cursor agent",
		command: "cursor",
		args: ["agent", "--acp"],
		hint: "Requires the Cursor CLI installed (`cursor` on PATH).",
	},
	"opencode": {
		name: "OpenCode",
		command: "npx",
		args: ["-y", "opencode", "--acp"],
		hint: "OpenCode CLI in ACP mode.",
	},
	"goose": {
		name: "Goose",
		command: "goose",
		args: ["acp"],
		hint: "Block's Goose CLI. Verify the exact subcommand for your installed version.",
	},
	"custom": {
		name: "Custom agent",
		command: "",
		args: [],
		hint: "Blank profile — fill in the command and args yourself.",
	},
};

export interface AgentProfile {
	id: string;
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
}

export type EffortLevel = "minimal" | "low" | "medium" | "high";

export interface AcpBridgeSettings {
	profiles: AgentProfile[];
	activeProfileId: string;
	autoApproveReads: boolean;
	autoApproveWritesInsideVault: boolean;
	logTraffic: boolean;
	effort: EffortLevel;
	savedSessions: SavedSession[];
	ruleFiles: string[];
}

export const DEFAULT_SETTINGS: AcpBridgeSettings = {
	profiles: [
		{
			id: "claude-code",
			name: "Claude Code",
			command: "npx",
			args: ["-y", "@zed-industries/claude-code-acp"],
			env: {},
		},
	],
	activeProfileId: "claude-code",
	autoApproveReads: true,
	autoApproveWritesInsideVault: false,
	logTraffic: false,
	effort: "medium",
	savedSessions: [],
	ruleFiles: [],
};

export class AcpBridgeSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: AcpBridgePlugin) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Agent profiles").setHeading();

		new Setting(containerEl)
			.setName("Active profile")
			.setDesc("Which profile new sessions launch with. Loading a saved session ignores this and uses whatever profile that session was created with.")
			.addDropdown(dd => {
				for (const p of this.plugin.settings.profiles) dd.addOption(p.id, p.name);
				dd.setValue(this.plugin.settings.activeProfileId);
				dd.onChange(async v => {
					this.plugin.settings.activeProfileId = v;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		let templateChoice = "claude-code";
		new Setting(containerEl)
			.setName("Add profile from template")
			.addDropdown(dd => {
				for (const [id, t] of Object.entries(PROFILE_TEMPLATES)) dd.addOption(id, t.name);
				dd.setValue(templateChoice);
				dd.onChange(v => { templateChoice = v; });
			})
			.addButton(b => b.setButtonText("Add").setCta().onClick(async () => {
				const tmpl = PROFILE_TEMPLATES[templateChoice];
				if (!tmpl) return;
				this.plugin.settings.profiles.push({
					id: crypto.randomUUID(),
					name: uniqueName(this.plugin.settings.profiles, tmpl.name),
					command: tmpl.command,
					args: [...tmpl.args],
					env: {},
				});
				await this.plugin.saveSettings();
				this.display();
			}));

		for (const profile of this.plugin.settings.profiles) {
			renderProfileBlock(containerEl, profile, this.plugin, () => this.display());
		}

		new Setting(containerEl).setName("Permissions").setHeading();

		new Setting(containerEl)
			.setName("Auto-approve file reads")
			.setDesc("Skip the prompt for read-only access to files inside the vault.")
			.addToggle(t => t.setValue(this.plugin.settings.autoApproveReads)
				.onChange(async v => { this.plugin.settings.autoApproveReads = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl)
			.setName("Auto-approve writes inside the vault")
			.setDesc("Off by default. When off, every write triggers a permission prompt.")
			.addToggle(t => t.setValue(this.plugin.settings.autoApproveWritesInsideVault)
				.onChange(async v => { this.plugin.settings.autoApproveWritesInsideVault = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl).setName("Rules").setHeading();

		const explainer = containerEl.createEl("p", { cls: "setting-item-description" });
		explainer.appendText("ACP Bridge auto-discovers ");
		explainer.createEl("code", { text: ".claude/rules/**/*.md" });
		explainer.appendText(" inside your vault and prepends matching rules to every prompt. Rules with a YAML ");
		explainer.createEl("code", { text: "paths:" });
		explainer.appendText(" list (glob patterns) only apply when the active file or an attached file/folder matches one of them. Rules without ");
		explainer.createEl("code", { text: "paths:" });
		explainer.appendText(" are unconditional. The vault root's ");
		explainer.createEl("code", { text: "CLAUDE.md" });
		explainer.appendText(" is auto-included as a primer when present.");

		new Setting(containerEl)
			.setName("Additional rule files")
			.setDesc("Extra files outside .claude/rules/ that should also be injected. Use this to point at rule files elsewhere in your vault.")
			.addButton(b => b
				.setButtonText("Add file")
				.onClick(() => {
					new VaultItemPicker(this.app, item => {
						if (!(item instanceof TFile)) return;
						if (this.plugin.settings.ruleFiles.includes(item.path)) return;
						this.plugin.settings.ruleFiles.push(item.path);
						void this.plugin.saveSettings().then(() => this.display());
					}, {
						placeholder: "Pick a rule file",
						filter: item => item instanceof TFile && !(item instanceof TFolder),
					}).open();
				}));

		for (const path of this.plugin.settings.ruleFiles) {
			const exists = !!this.app.vault.getFileByPath(path);
			new Setting(containerEl)
				.setName(path)
				.setDesc(exists ? "" : "⚠ File not found in vault.")
				.addExtraButton(b => b
					.setIcon("trash")
					.setTooltip("Remove")
					.onClick(async () => {
						this.plugin.settings.ruleFiles = this.plugin.settings.ruleFiles.filter(p => p !== path);
						await this.plugin.saveSettings();
						this.display();
					}));
		}

		new Setting(containerEl).setName("Saved sessions").setHeading();
		if (this.plugin.settings.savedSessions.length === 0) {
			containerEl.createEl("p", {
				text: "No saved sessions yet. Sessions are saved automatically when you start one.",
				cls: "setting-item-description",
			});
		}
		const sessions = [...this.plugin.settings.savedSessions].sort((a, b) => b.lastUsed - a.lastUsed);
		for (const s of sessions) {
			const profile = this.plugin.settings.profiles.find(p => p.id === s.profileId);
			new Setting(containerEl)
				.setName(s.title || "(untitled)")
				.setDesc(`${profile?.name ?? s.profileId} · ${formatRelative(s.lastUsed)} · ${s.sessionId}`)
				.addExtraButton(b => b.setIcon("pencil").setTooltip("Rename").onClick(async () => {
					const next = window.prompt("New title", s.title);
					if (next == null) return;
					s.title = next.trim() || s.title;
					await this.plugin.saveSettings();
					this.display();
				}))
				.addExtraButton(b => b.setIcon("trash").setTooltip("Delete").onClick(async () => {
					this.plugin.settings.savedSessions = this.plugin.settings.savedSessions.filter(x => x.id !== s.id);
					await this.plugin.saveSettings();
					this.display();
				}));
		}

		new Setting(containerEl).setName("Diagnostics").setHeading();

		new Setting(containerEl)
			.setName("Log JSON-RPC traffic to console")
			.setDesc("Useful when an agent does something unexpected. Off in normal use.")
			.addToggle(t => t.setValue(this.plugin.settings.logTraffic)
				.onChange(async v => { this.plugin.settings.logTraffic = v; await this.plugin.saveSettings(); }));
	}
}

function renderProfileBlock(
	containerEl: HTMLElement,
	profile: AgentProfile,
	plugin: AcpBridgePlugin,
	refresh: () => void,
): void {
	const wrap = containerEl.createDiv({ cls: "acp-profile" });
	new Setting(wrap).setName(profile.name).setHeading();

	const hintTemplate = Object.values(PROFILE_TEMPLATES).find(t => t.name === profile.name);
	if (hintTemplate?.hint) {
		wrap.createEl("p", { text: hintTemplate.hint, cls: "setting-item-description" });
	}

	new Setting(wrap)
		.setName("Display name")
		.addText(t => t.setValue(profile.name).onChange(async v => {
			profile.name = v.trim() || profile.name;
			await plugin.saveSettings();
		}));

	new Setting(wrap)
		.setName("Command")
		.setDesc("Executable that speaks ACP over stdio.")
		.addText(t => t.setValue(profile.command).onChange(async v => {
			profile.command = v;
			await plugin.saveSettings();
		}));

	new Setting(wrap)
		.setName("Arguments")
		.setDesc("Whitespace-separated args. Quoting not supported.")
		.addText(t => t.setValue(profile.args.join(" ")).onChange(async v => {
			profile.args = v.split(/\s+/).filter(Boolean);
			await plugin.saveSettings();
		}));

	new Setting(wrap)
		.setName("Environment variables")
		.setDesc("One KEY=value per line. Inherits Obsidian's process env on top.")
		.addTextArea(t => {
			t.setValue(serializeEnv(profile.env));
			t.inputEl.rows = 3;
			t.onChange(async v => {
				profile.env = parseEnv(v);
				await plugin.saveSettings();
			});
		});

	const isActive = profile.id === plugin.settings.activeProfileId;
	const onlyOne = plugin.settings.profiles.length === 1;
	new Setting(wrap)
		.addButton(b => b.setButtonText("Delete profile")
			.setWarning()
			.setDisabled(isActive || onlyOne)
			.onClick(async () => {
				if (isActive || onlyOne) return;
				plugin.settings.profiles = plugin.settings.profiles.filter(p => p.id !== profile.id);
				await plugin.saveSettings();
				new Notice(`Deleted profile "${profile.name}".`);
				refresh();
			}));
}

function uniqueName(profiles: AgentProfile[], base: string): string {
	const taken = new Set(profiles.map(p => p.name));
	if (!taken.has(base)) return base;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base} ${i}`;
		if (!taken.has(candidate)) return candidate;
	}
	return `${base} ${Date.now()}`;
}

function serializeEnv(env: Record<string, string>): string {
	return Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n");
}

function parseEnv(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const key = line.slice(0, eq).trim();
		const value = line.slice(eq + 1).trim();
		if (key) out[key] = value;
	}
	return out;
}

function formatRelative(ts: number): string {
	const diff = Date.now() - ts;
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "just now";
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const d = Math.floor(hr / 24);
	if (d < 30) return `${d}d ago`;
	return new Date(ts).toLocaleDateString();
}
