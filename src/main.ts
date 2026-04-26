import { Plugin, WorkspaceLeaf } from "obsidian";

import { AcpBridgeSettings, AcpBridgeSettingTab, AgentProfile, DEFAULT_SETTINGS } from "./settings";
import { createAcpController, type AcpController } from "./acp/client";
import { ChatView, CHAT_VIEW_TYPE } from "./ui/chat-view";

export default class AcpBridgePlugin extends Plugin {
	settings!: AcpBridgeSettings;
	controller!: AcpController;

	async onload() {
		await this.loadSettings();
		this.controller = createAcpController(
			this.app,
			() => this.settings,
			() => this.saveSettings(),
		);

		this.registerView(CHAT_VIEW_TYPE, leaf => new ChatView(leaf, this));

		this.addRibbonIcon("bot", "Open ACP chat", () => this.openChatView());
		this.addCommand({
			id: "open-chat",
			name: "Open chat",
			callback: () => this.openChatView(),
		});
		this.addCommand({
			id: "start-session",
			name: "Start agent session",
			callback: () => this.controller.start(this.activeProfile()),
		});
		this.addCommand({
			id: "stop-session",
			name: "Stop agent session",
			callback: () => this.controller.stop(),
		});
		this.addCommand({
			id: "cancel-turn",
			name: "Cancel current turn",
			callback: () => this.controller.cancel(),
		});

		this.addSettingTab(new AcpBridgeSettingTab(this.app, this));
	}

	onunload() {
		void this.controller?.stop();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AcpBridgeSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	activeProfile(): AgentProfile {
		const found = this.settings.profiles.find(p => p.id === this.settings.activeProfileId);
		if (found) return found;
		const fallback = this.settings.profiles[0];
		if (!fallback) throw new Error("No agent profiles configured.");
		return fallback;
	}

	async openChatView() {
		const existing = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		let leaf: WorkspaceLeaf | null = existing[0] ?? null;
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		}
		if (leaf) await this.app.workspace.revealLeaf(leaf);
	}
}
