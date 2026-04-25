<script setup lang="ts">
import type { ChatItem } from "../../acp/types";
import { useController } from "../composables/useController";

type Permission = Extract<ChatItem, { kind: "permission" }>;
const props = defineProps<{ request: Permission }>();
const controller = useController();

function pick(optionId: string) {
	controller.resolvePermission(props.request.id, optionId);
}

function variant(kind: string): string {
	if (kind.startsWith("allow")) return "allow";
	if (kind.startsWith("reject")) return "reject";
	return "neutral";
}
</script>

<template>
	<div :class="['acp-permission', `acp-permission--${request.outcome.state}`]">
		<div class="acp-permission__header">
			<span class="acp-permission__icon">⚠</span>
			<span class="acp-permission__title">Agent wants to: <strong>{{ request.toolCall.title }}</strong></span>
		</div>
		<div v-if="request.toolCall.kind" class="acp-permission__kind">{{ request.toolCall.kind }}</div>
		<div v-if="request.toolCall.locations?.length" class="acp-permission__locations">
			<div v-for="(l, i) in request.toolCall.locations" :key="i">{{ l.path }}<span v-if="l.line != null">:{{ l.line }}</span></div>
		</div>
		<div v-if="request.outcome.state === 'pending'" class="acp-permission__actions">
			<button
				v-for="opt in request.options"
				:key="opt.optionId"
				:class="['acp-permission__btn', `acp-permission__btn--${variant(opt.kind)}`]"
				@click="pick(opt.optionId)"
			>
				{{ opt.name }}
			</button>
		</div>
		<div v-else-if="request.outcome.state === 'decided'" class="acp-permission__decided">
			→ {{ request.outcome.optionName }}
		</div>
		<div v-else class="acp-permission__cancelled">→ cancelled</div>
	</div>
</template>
