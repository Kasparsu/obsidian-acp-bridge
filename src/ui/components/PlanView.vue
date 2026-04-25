<script setup lang="ts">
import type { Plan } from "../../acp/types";

defineProps<{ plan: Plan }>();
</script>

<template>
	<div class="acp-plan">
		<div class="acp-plan__heading">Plan</div>
		<ol class="acp-plan__list">
			<li
				v-for="(entry, i) in plan.entries"
				:key="i"
				:class="['acp-plan__entry', `acp-plan__entry--${entry.status}`]"
			>
				<span class="acp-plan__priority">[{{ entry.priority }}]</span>
				{{ entry.content }}
			</li>
		</ol>
	</div>
</template>
