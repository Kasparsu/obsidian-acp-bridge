<script setup lang="ts">
import { computed } from "vue";
import { useController, usePlugin } from "../composables/useController";
import type { EffortLevel } from "../../settings";
import type { SessionConfigOption } from "../../acp/types";

const controller = useController();
const plugin = usePlugin();

const configOptions = computed(() => controller.sessionConfig.configOptions);
const models = computed(() => controller.sessionConfig.models);
const modes = computed(() => controller.sessionConfig.modes);

const showModelStandalone = computed(() => {
	const hasConfigModel = configOptions.value.some(o => o.category === "model");
	return !hasConfigModel && models.value && models.value.availableModels.length > 0;
});

const showModeStandalone = computed(() => {
	const hasConfigMode = configOptions.value.some(o => o.category === "mode");
	return !hasConfigMode && modes.value && modes.value.availableModes.length > 0;
});

const showLocalEffort = computed(() => !configOptions.value.some(o => o.category === "thought_level"));

const effort = computed({
	get: () => plugin.settings.effort,
	set: async (v: EffortLevel) => { plugin.settings.effort = v; await plugin.saveSettings(); },
});

const EFFORT_OPTIONS: { value: EffortLevel; name: string }[] = [
	{ value: "minimal", name: "Effort: minimal" },
	{ value: "low",     name: "Effort: low" },
	{ value: "medium",  name: "Effort: medium" },
	{ value: "high",    name: "Effort: high" },
];

function flatOptions(opt: SessionConfigOption): { value: string; name: string }[] {
	if (opt.type !== "select") return [];
	const opts = opt.options;
	if (opts.length === 0) return [];
	const first = opts[0] as Record<string, unknown>;
	if ("group" in first) {
		return (opts as { options: { value: string; name: string }[] }[]).flatMap(g => g.options);
	}
	return opts as { value: string; name: string }[];
}

function isSelect(opt: SessionConfigOption): boolean { return opt.type === "select"; }
function isBool(opt: SessionConfigOption): boolean   { return opt.type === "boolean"; }

function onSelectChange(configId: string, e: Event) {
	controller.setConfigOption(configId, (e.target as HTMLSelectElement).value);
}
function onBoolChange(configId: string, e: Event) {
	controller.setConfigOption(configId, (e.target as HTMLInputElement).checked);
}
function onModelChange(e: Event) { controller.setModel((e.target as HTMLSelectElement).value); }
function onModeChange(e: Event)  { controller.setMode((e.target as HTMLSelectElement).value); }
function onEffortChange(e: Event) { effort.value = (e.target as HTMLSelectElement).value as EffortLevel; }
</script>

<template>
	<div class="acp-config">
		<template v-for="opt in configOptions" :key="opt.id">
			<select
				v-if="isSelect(opt)"
				:value="opt.currentValue"
				:title="opt.name"
				@change="onSelectChange(opt.id, $event)"
			>
				<option v-for="v in flatOptions(opt)" :key="v.value" :value="v.value">{{ v.name }}</option>
			</select>
			<label v-else-if="isBool(opt)" class="acp-config__bool" :title="opt.name">
				<input type="checkbox" :checked="!!opt.currentValue" @change="onBoolChange(opt.id, $event)" />
				<span>{{ opt.name }}</span>
			</label>
		</template>

		<select v-if="showModelStandalone && models" :value="models.currentModelId" title="Model" @change="onModelChange">
			<option v-for="m in models.availableModels" :key="m.modelId" :value="m.modelId">{{ m.name }}</option>
		</select>

		<select v-if="showModeStandalone && modes" :value="modes.currentModeId" title="Mode" @change="onModeChange">
			<option v-for="m in modes.availableModes" :key="m.id" :value="m.id">{{ m.name }}</option>
		</select>

		<select v-if="showLocalEffort" :value="effort" title="Reasoning effort (injected as prompt hint)" @change="onEffortChange">
			<option v-for="o in EFFORT_OPTIONS" :key="o.value" :value="o.value">{{ o.name }}</option>
		</select>
	</div>
</template>
