import { App, parseYaml, type DataAdapter } from "obsidian";

export interface DiscoveredRule {
	path: string;
	body: string;
	pathGlobs: string[];
}

const RULES_DIR = ".claude/rules";
const PRIMER_FILE = "CLAUDE.md";

export async function discoverRules(app: App): Promise<DiscoveredRule[]> {
	const adapter = app.vault.adapter;
	if (!(await adapter.exists(RULES_DIR))) return [];
	const out: DiscoveredRule[] = [];
	await walk(adapter, RULES_DIR, out);
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

async function walk(adapter: DataAdapter, dir: string, out: DiscoveredRule[]): Promise<void> {
	const listing = await adapter.list(dir);
	for (const filePath of listing.files) {
		if (!filePath.endsWith(".md")) continue;
		const text = await adapter.read(filePath);
		out.push({ path: filePath, ...parseFrontmatter(text) });
	}
	for (const subdir of listing.folders) {
		await walk(adapter, subdir, out);
	}
}

function parseFrontmatter(text: string): { body: string; pathGlobs: string[] } {
	if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
		return { body: text, pathGlobs: [] };
	}
	const after = text.indexOf("\n---", 4);
	if (after < 0) return { body: text, pathGlobs: [] };
	const fmText = text.slice(4, after);
	const bodyStart = text.indexOf("\n", after + 4);
	const body = bodyStart < 0 ? "" : text.slice(bodyStart + 1);
	let fm: unknown = null;
	try { fm = parseYaml(fmText); } catch { /* ignore — treat as no frontmatter */ }
	const paths = isObject(fm) && Array.isArray(fm.paths)
		? fm.paths.filter((p): p is string => typeof p === "string")
		: [];
	return { body, pathGlobs: paths };
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

export function ruleApplies(rule: DiscoveredRule, candidatePaths: (string | null)[]): boolean {
	if (rule.pathGlobs.length === 0) return true;
	for (const candidate of candidatePaths) {
		if (!candidate) continue;
		if (rule.pathGlobs.some(g => globMatch(g, candidate))) return true;
	}
	return false;
}

export function globMatch(pattern: string, str: string): boolean {
	return globToRegex(pattern).test(str);
}

function globToRegex(pattern: string): RegExp {
	const trimmed = pattern.startsWith("/") ? pattern.slice(1) : pattern;
	let out = "";
	for (let i = 0; i < trimmed.length; i++) {
		const c = trimmed.charAt(i);
		const next = trimmed.charAt(i + 1);
		if (c === "*" && next === "*") {
			out += ".*";
			i++;
		} else if (c === "*") {
			out += "[^/]*";
		} else if (c === "?") {
			out += "[^/]";
		} else if (".+^${}()|[]\\".includes(c)) {
			out += "\\" + c;
		} else {
			out += c;
		}
	}
	return new RegExp("^" + out + "$");
}

export async function readPrimer(app: App): Promise<{ path: string; body: string } | null> {
	const file = app.vault.getFileByPath(PRIMER_FILE);
	if (!file) return null;
	const body = await app.vault.cachedRead(file);
	return { path: PRIMER_FILE, body };
}
