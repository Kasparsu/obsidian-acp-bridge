<script setup lang="ts">
import { useController } from "../composables/useController";

const props = defineProps<{ modelValue: string; disabled: boolean }>();
const emit = defineEmits<{
	"update:modelValue": [value: string];
	submit: [];
}>();

const controller = useController();

function onInput(e: Event) {
	emit("update:modelValue", (e.target as HTMLTextAreaElement).value);
}

function onKeydown(e: KeyboardEvent) {
	if (e.key !== "Enter") return;
	if (e.isComposing) return;
	if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
	e.preventDefault();
	if (!props.disabled && props.modelValue.trim()) emit("submit");
}

function onPaste(e: ClipboardEvent) {
	const items = e.clipboardData?.items;
	if (!items || items.length === 0) return;
	const images: File[] = [];
	for (const it of items) {
		if (it.kind === "file" && it.type.startsWith("image/")) {
			const f = it.getAsFile();
			if (f) images.push(f);
		}
	}
	if (images.length === 0) return;
	e.preventDefault();
	for (const img of images) void controller.addImageFromBlob(img);
}
</script>

<template>
	<textarea
		class="acp-input__textarea"
		:value="modelValue"
		:disabled="disabled"
		rows="3"
		placeholder="Message the agent (Enter to send · Shift+Enter for newline · paste images)"
		@input="onInput"
		@keydown="onKeydown"
		@paste="onPaste"
	/>
</template>
