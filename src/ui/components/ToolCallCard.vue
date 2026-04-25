<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatItem } from "../../acp/types";

type ToolCall = Extract<ChatItem, { kind: "tool_call" }>;
const props = defineProps<{ toolCall: ToolCall }>();

const expanded = ref(false);

const glyph = computed(() => {
	switch (props.toolCall.status) {
		case "pending":     return "·";
		case "in_progress": return "⋯";
		case "completed":   return "✓";
		case "failed":      return "✗";
		default:            return "?";
	}
});

const inputPreview = computed(() => {
	const ri = props.toolCall.rawInput;
	if (!ri) return "";
	try { return JSON.stringify(ri, null, 2); } catch { return String(ri); }
});

const contentText = computed(() =>
	props.toolCall.content
		.map(c => {
			if (c.type === "content" && c.content?.type === "text") return c.content.text;
			if (c.type === "diff") return `--- ${c.path}\n${c.oldText ?? ""}\n+++\n${c.newText}`;
			if (c.type === "terminal") return `[terminal ${c.terminalId}]`;
			return `[${c.type}]`;
		})
		.join("\n"),
);

const hasDetails = computed(() =>
	props.toolCall.rawInput != null || props.toolCall.content.length > 0 || (props.toolCall.locations?.length ?? 0) > 0,
);
</script>

<template>
	<div :class="['acp-toolcall', `acp-toolcall--${toolCall.status}`]">
		<button
			class="acp-toolcall__header"
			:disabled="!hasDetails"
			@click="expanded = !expanded"
		>
			<span class="acp-toolcall__glyph">{{ glyph }}</span>
			<span class="acp-toolcall__title">{{ toolCall.title }}</span>
			<span class="acp-toolcall__kind">{{ toolCall.toolKind }}</span>
			<span v-if="hasDetails" class="acp-toolcall__chevron">{{ expanded ? "▾" : "▸" }}</span>
		</button>
		<div v-if="expanded && hasDetails" class="acp-toolcall__body">
			<div v-if="toolCall.locations?.length" class="acp-toolcall__locations">
				<div class="acp-toolcall__label">Files</div>
				<ul>
					<li v-for="(l, i) in toolCall.locations" :key="i">{{ l.path }}<span v-if="l.line != null">:{{ l.line }}</span></li>
				</ul>
			</div>
			<div v-if="inputPreview" class="acp-toolcall__input">
				<div class="acp-toolcall__label">Input</div>
				<pre>{{ inputPreview }}</pre>
			</div>
			<div v-if="contentText" class="acp-toolcall__output">
				<div class="acp-toolcall__label">Output</div>
				<pre>{{ contentText }}</pre>
			</div>
		</div>
	</div>
</template>
