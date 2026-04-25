<script setup lang="ts">
import type { ChatItem } from "../../acp/types";
import PermissionRequest from "./PermissionRequest.vue";

type Permission = Extract<ChatItem, { kind: "permission" }>;
defineProps<{ items: Permission[] }>();
</script>

<template>
	<div v-if="items.length" class="acp-permissions">
		<PermissionRequest v-for="p in items" :key="p.id" :request="p" />
	</div>
</template>
