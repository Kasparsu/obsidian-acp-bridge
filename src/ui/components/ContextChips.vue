<script setup lang="ts">
import { Notice, TFile, TFolder } from "obsidian";
import { useController, usePlugin } from "../composables/useController";
import { VaultItemPicker } from "../modals/VaultItemPicker";
import { isImageFile } from "../../acp/client";

const controller = useController();
const plugin = usePlugin();

function addFileOrFolder() {
	new VaultItemPicker(plugin.app, item => {
		if (item instanceof TFile && isImageFile(item)) {
			void controller.addImageFromVault(item);
		} else {
			controller.addContextRef({
				kind: item instanceof TFolder ? "folder" : "file",
				path: item.path,
				name: item.name,
			});
		}
	}, { placeholder: "Pick a file or folder" }).open();
}

function addImage() {
	new VaultItemPicker(plugin.app, item => {
		if (item instanceof TFile) void controller.addImageFromVault(item);
	}, {
		placeholder: "Pick an image from the vault",
		filter: item => item instanceof TFile && isImageFile(item),
	}).open();
}

function addSelection() {
	const before = controller.contextRefs.length;
	controller.addCurrentSelection();
	if (controller.contextRefs.length === before) {
		new Notice("No text selected in the active editor.");
	}
}
</script>

<template>
	<div class="acp-chips">
		<button class="acp-chips__add" @click="addFileOrFolder" title="Attach a file or folder">+ File</button>
		<button class="acp-chips__add" @click="addImage" title="Attach an image">+ Image</button>
		<button class="acp-chips__add" @click="addSelection" title="Attach the current editor selection">+ Selection</button>
		<div
			v-for="ref in controller.contextRefs"
			:key="ref.id"
			:class="['acp-chip', `acp-chip--${ref.kind}`]"
			:title="ref.kind === 'selection' ? ref.text : (ref.kind === 'image' ? ref.mimeType : ref.path)"
		>
			<img
				v-if="ref.kind === 'image'"
				class="acp-chip__thumb"
				:src="`data:${ref.mimeType};base64,${ref.data}`"
				alt=""
			/>
			<span v-else class="acp-chip__icon">
				{{ ref.kind === "folder" ? "📁" : ref.kind === "selection" ? "✂" : "📄" }}
			</span>
			<span class="acp-chip__name">{{ ref.name }}</span>
			<button
				class="acp-chip__remove"
				@click="controller.removeContextRef(ref.id)"
				:aria-label="`Remove ${ref.name}`"
			>×</button>
		</div>
	</div>
</template>
