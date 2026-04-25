<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Component, MarkdownRenderer } from "obsidian";
import { usePlugin } from "../composables/useController";
import type { ChatItem } from "../../acp/types";

type Message = Extract<ChatItem, { kind: "message" }>;
const props = defineProps<{ message: Message }>();
const plugin = usePlugin();

const text = computed(() =>
	props.message.chunks
		.map(c => c.type === "text" ? c.text : `_[${c.type}]_`)
		.join(""),
);

const roleLabel = computed(() => {
	switch (props.message.role) {
		case "user":    return "You";
		case "agent":   return "Agent";
		case "thought": return "Agent (thinking)";
	}
});

const useMarkdown = props.message.role === "agent";
const renderEl = ref<HTMLElement | null>(null);
const renderer = new Component();

async function rerender() {
	const el = renderEl.value;
	if (!el || !useMarkdown) return;
	el.empty();
	const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? "";
	try {
		await MarkdownRenderer.render(plugin.app, text.value, el, sourcePath, renderer);
	} catch (err) {
		console.error("[acp] markdown render failed", err);
		el.setText(text.value);
	}
}

onMounted(() => {
	renderer.load();
	void rerender();
});
watch(text, () => { void rerender(); });
onBeforeUnmount(() => renderer.unload());
</script>

<template>
	<div :class="['acp-message', `acp-message--${message.role}`]">
		<div class="acp-message__role">{{ roleLabel }}</div>
		<div
			v-if="useMarkdown"
			ref="renderEl"
			class="acp-message__body acp-message__body--markdown"
		/>
		<div v-else class="acp-message__body">{{ text }}</div>
	</div>
</template>
