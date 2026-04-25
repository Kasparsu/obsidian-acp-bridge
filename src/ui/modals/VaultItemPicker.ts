import { App, FuzzySuggestModal, TAbstractFile, TFolder } from "obsidian";

export interface VaultItemPickerOptions {
	placeholder?: string;
	filter?: (item: TAbstractFile) => boolean;
}

export class VaultItemPicker extends FuzzySuggestModal<TAbstractFile> {
	private readonly filter?: (item: TAbstractFile) => boolean;

	constructor(app: App, private onPick: (item: TAbstractFile) => void, options: VaultItemPickerOptions = {}) {
		super(app);
		this.filter = options.filter;
		this.setPlaceholder(options.placeholder ?? "Pick a file or folder to attach as context");
	}

	getItems(): TAbstractFile[] {
		const out: TAbstractFile[] = [];
		const root = this.app.vault.getRoot();
		for (const child of root.children) walk(child, out);
		const filtered = this.filter ? out.filter(this.filter) : out;
		filtered.sort((a, b) => {
			const af = a instanceof TFolder ? 0 : 1;
			const bf = b instanceof TFolder ? 0 : 1;
			if (af !== bf) return af - bf;
			return a.path.localeCompare(b.path);
		});
		return filtered;
	}

	getItemText(item: TAbstractFile): string {
		const prefix = item instanceof TFolder ? "📁  " : "📄  ";
		return prefix + item.path;
	}

	onChooseItem(item: TAbstractFile): void {
		this.onPick(item);
	}
}

function walk(item: TAbstractFile, out: TAbstractFile[]): void {
	out.push(item);
	if (item instanceof TFolder) {
		for (const child of item.children) walk(child, out);
	}
}
