import { App, FileSystemAdapter, Notice, TFile, normalizePath } from "obsidian";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";

export class VaultFs {
	readonly basePath: string;

	constructor(private app: App) {
		const adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("ACP Bridge requires a desktop vault (FileSystemAdapter).");
		}
		this.basePath = adapter.getBasePath();
	}

	private toVaultRel(absPath: string): string {
		const abs = isAbsolute(absPath) ? resolve(absPath) : resolve(this.basePath, absPath);
		const rel = relative(this.basePath, abs);
		if (rel.startsWith("..") || isAbsolute(rel)) {
			throw new Error(`Path is outside the vault: ${absPath}`);
		}
		return normalizePath(rel);
	}

	async readTextFile(req: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
		const rel = this.toVaultRel(req.path);
		const file = this.app.vault.getFileByPath(rel);
		if (!file) {
			const raw = await this.app.vault.adapter.read(rel).catch(() => null);
			if (raw === null) throw new Error(`File not found: ${rel}`);
			return { content: sliceLines(raw, req.line ?? null, req.limit ?? null) };
		}
		const text = await this.app.vault.cachedRead(file);
		return { content: sliceLines(text, req.line ?? null, req.limit ?? null) };
	}

	async writeTextFile(req: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
		const rel = this.toVaultRel(req.path);
		const existing = this.app.vault.getFileByPath(rel);
		if (existing instanceof TFile) {
			await this.app.vault.process(existing, () => req.content);
		} else {
			const dir = dirname(rel);
			if (dir && dir !== "." && !this.app.vault.getFolderByPath(dir)) {
				await this.app.vault.createFolder(dir).catch(() => {});
			}
			await this.app.vault.create(rel, req.content);
		}
		new Notice(`ACP: wrote ${rel}`);
		return {};
	}

	isInsideVault(absPath: string): boolean {
		try { this.toVaultRel(absPath); return true; } catch { return false; }
	}
}

function sliceLines(text: string, line: number | null, limit: number | null): string {
	if (line == null && limit == null) return text;
	const lines = text.split(/\r?\n/);
	const start = Math.max(0, (line ?? 1) - 1);
	const end = limit == null ? lines.length : Math.min(lines.length, start + limit);
	return lines.slice(start, end).join("\n");
}
