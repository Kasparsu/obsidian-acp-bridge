<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { ChatItem } from "../../acp/types";
import MessageItem from "./MessageItem.vue";
import ToolCallCard from "./ToolCallCard.vue";
import PermissionRequest from "./PermissionRequest.vue";

const props = defineProps<{ items: ChatItem[]; thinking: boolean }>();

const visible = computed(() =>
	props.items.filter(i => i.kind !== "permission" || i.outcome.state !== "pending"),
);

const scrollEl = ref<HTMLElement | null>(null);

watch(
	() => visible.value.length,
	async () => {
		await nextTick();
		const el = scrollEl.value;
		if (el) el.scrollTop = el.scrollHeight;
	},
);
</script>

<template>
	<div class="acp-messages" ref="scrollEl">
		<template v-for="item in visible" :key="item.id">
			<MessageItem v-if="item.kind === 'message'" :message="item" />
			<ToolCallCard v-else-if="item.kind === 'tool_call'" :tool-call="item" />
			<PermissionRequest v-else-if="item.kind === 'permission'" :request="item" />
		</template>
		<div v-if="thinking" class="acp-messages__thinking">…</div>
	</div>
</template>
