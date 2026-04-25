<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useController, usePlugin } from "./composables/useController";
import MessageList from "./components/MessageList.vue";
import PlanView from "./components/PlanView.vue";
import InputBar from "./components/InputBar.vue";
import SessionConfigBar from "./components/SessionConfigBar.vue";
import ContextChips from "./components/ContextChips.vue";
import PermissionPanel from "./components/PermissionPanel.vue";
import { SessionsPicker } from "./modals/SessionsPicker";
import type { ChatItem } from "../acp/types";

const controller = useController();
const plugin = usePlugin();

const draft = ref("");

const status = computed(() => {
	const s = controller.state.value;
	switch (s.kind) {
		case "idle":     return { label: "Idle",     tone: "muted"   as const };
		case "starting": return { label: "Starting…", tone: "info"    as const };
		case "ready":    return { label: "Ready",    tone: "ok"      as const };
		case "error":    return { label: `Error: ${s.message}`, tone: "error" as const };
	}
});

const profileName = computed(() => plugin.activeProfile().name);

const pendingPermissions = computed(() =>
	controller.chatItems.filter(
		(i): i is Extract<ChatItem, { kind: "permission" }> =>
			i.kind === "permission" && i.outcome.state === "pending",
	),
);

const canSend = computed(() => controller.state.value.kind === "ready" && draft.value.trim().length > 0);

async function cancel(){ await controller.cancel(); }

async function onProfileChange(e: Event) {
	const id = (e.target as HTMLSelectElement).value;
	if (id === plugin.settings.activeProfileId) return;
	plugin.settings.activeProfileId = id;
	await plugin.saveSettings();
	await controller.stop();
	await controller.autoStart(plugin.activeProfile());
}

onMounted(() => {
	if (controller.state.value.kind === "idle") {
		void controller.autoStart(plugin.activeProfile());
	}
});

async function send() {
	if (!canSend.value) return;
	const text = draft.value.trim();
	draft.value = "";
	await controller.sendPrompt(text);
}

function openSessions() {
	new SessionsPicker(plugin.app, {
		sessions: plugin.settings.savedSessions,
		profiles: plugin.settings.profiles,
		currentSavedId: controller.currentSavedId.value,
		onPick: id => { void controller.loadSavedSession(id); },
		onDelete: id => {
			plugin.settings.savedSessions = plugin.settings.savedSessions.filter(s => s.id !== id);
			void plugin.saveSettings();
		},
	}).open();
}

const currentSessionTitle = computed(() => {
	const id = controller.currentSavedId.value;
	if (!id) return null;
	return plugin.settings.savedSessions.find(s => s.id === id)?.title ?? null;
});
</script>

<template>
	<div class="acp-chat">
		<header class="acp-chat__header">
			<div>
				<div class="acp-chat__title">
					{{ currentSessionTitle || "ACP Bridge" }}
				</div>
				<div :class="['acp-chat__status', `acp-chat__status--${status.tone}`]">
					<span class="acp-dot" />
					{{ status.label }} ·
					<select
						v-if="plugin.settings.profiles.length > 1"
						class="acp-chat__profile"
						:value="plugin.settings.activeProfileId"
						title="Switch agent — stops current session and resumes the most recent for the chosen agent"
						@change="onProfileChange"
					>
						<option v-for="p in plugin.settings.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
					</select>
					<span v-else>{{ profileName }}</span>
				</div>
			</div>
			<div class="acp-chat__actions">
				<button
					@click="openSessions"
					:disabled="!plugin.settings.savedSessions.length"
					title="Open a saved session"
				>Sessions</button>
				<button v-if="controller.thinking.value" @click="cancel">Cancel turn</button>
			</div>
		</header>

		<PlanView v-if="controller.plan.value" :plan="controller.plan.value" />

		<MessageList :items="controller.chatItems" :thinking="controller.thinking.value" />

		<div class="acp-compose">
			<ContextChips />
			<InputBar
				v-model="draft"
				:disabled="controller.state.value.kind !== 'ready'"
				@submit="send"
			/>
			<PermissionPanel :items="pendingPermissions" />
			<div class="acp-compose__bottom">
				<SessionConfigBar />
				<button class="acp-compose__send" :disabled="!canSend" @click="send">Send</button>
			</div>
		</div>
	</div>
</template>
