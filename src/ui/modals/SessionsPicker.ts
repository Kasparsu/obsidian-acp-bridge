import { App, FuzzySuggestModal } from "obsidian";
import type { SavedSession } from "../../acp/types";
import type { AgentProfile } from "../../settings";

export interface SessionsPickerOptions {
	sessions: SavedSession[];
	profiles: AgentProfile[];
	currentSavedId: string | null;
	onPick: (sessionId: string) => void;
	onDelete: (sessionId: string) => void;
}

export class SessionsPicker extends FuzzySuggestModal<SavedSession> {
	constructor(app: App, private opts: SessionsPickerOptions) {
		super(app);
		this.setPlaceholder("Pick a saved session — Shift+click to delete");
		this.setInstructions([
			{ command: "↵", purpose: "load session" },
			{ command: "Shift+↵", purpose: "delete session" },
		]);
	}

	getItems(): SavedSession[] {
		return [...this.opts.sessions].sort((a, b) => b.lastUsed - a.lastUsed);
	}

	getItemText(s: SavedSession): string {
		const profile = this.opts.profiles.find(p => p.id === s.profileId);
		const current = s.id === this.opts.currentSavedId ? " · current" : "";
		return `${s.title || "(untitled)"}  —  ${profile?.name ?? s.profileId} · ${formatRelative(s.lastUsed)}${current}`;
	}

	onChooseItem(s: SavedSession, evt: MouseEvent | KeyboardEvent): void {
		if (evt.shiftKey) this.opts.onDelete(s.id);
		else this.opts.onPick(s.id);
	}
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
