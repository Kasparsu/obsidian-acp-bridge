import { ItemView, WorkspaceLeaf } from "obsidian";
import { createApp, type App as VueApp } from "vue";
import App from "./App.vue";
import type AcpBridgePlugin from "../main";

export const CHAT_VIEW_TYPE = "acp-bridge-chat";

export class ChatView extends ItemView {
	private vueApp: VueApp | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: AcpBridgePlugin) {
		super(leaf);
	}

	getViewType() { return CHAT_VIEW_TYPE; }
	getDisplayText() { return "Agents"; }
	getIcon() { return "bot"; }

	onOpen(): Promise<void> {
		this.contentEl.empty();
		const root = this.contentEl.createDiv({ cls: "acp-chat-root" });
		this.vueApp = createApp(App);
		this.vueApp.provide("plugin", this.plugin);
		this.vueApp.provide("controller", this.plugin.controller);
		this.vueApp.mount(root);
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.vueApp?.unmount();
		this.vueApp = null;
		return Promise.resolve();
	}
}
