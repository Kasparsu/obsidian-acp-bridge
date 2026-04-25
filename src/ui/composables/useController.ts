import { inject } from "vue";
import type { AcpController } from "../../acp/client";
import type AcpBridgePlugin from "../../main";

export function useController(): AcpController {
	const c = inject<AcpController>("controller");
	if (!c) throw new Error("AcpController was not provided by the host view.");
	return c;
}

export function usePlugin(): AcpBridgePlugin {
	const p = inject<AcpBridgePlugin>("plugin");
	if (!p) throw new Error("Plugin was not provided by the host view.");
	return p;
}
