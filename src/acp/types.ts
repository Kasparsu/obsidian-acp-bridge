import type * as acp from "@agentclientprotocol/sdk";

export type SessionId = acp.SessionId;
export type ContentBlock = acp.ContentBlock;
export type ToolCallStatus = acp.ToolCallStatus;
export type Plan = acp.Plan;
export type SessionConfigOption = acp.SessionConfigOption;
export type SessionModelState = acp.SessionModelState;
export type SessionModeState = acp.SessionModeState;

export type ConnectionState =
	| { kind: "idle" }
	| { kind: "starting" }
	| { kind: "ready"; sessionId: SessionId }
	| { kind: "error"; message: string };

export type ChatItem =
	| {
			kind: "message";
			id: string;
			role: "user" | "agent" | "thought";
			chunks: ContentBlock[];
	  }
	| {
			kind: "tool_call";
			id: string;
			toolCallId: string;
			title: string;
			toolKind: acp.ToolKind;
			status: ToolCallStatus;
			rawInput?: unknown;
			content: acp.ToolCallContent[];
			locations?: acp.ToolCallLocation[];
	  }
	| {
			kind: "permission";
			id: string;
			toolCall: acp.ToolCallUpdate;
			options: acp.PermissionOption[];
			outcome:
				| { state: "pending" }
				| { state: "decided"; optionId: string; optionName: string }
				| { state: "cancelled" };
	  };

export interface SessionConfig {
	configOptions: SessionConfigOption[];
	models: SessionModelState | null;
	modes: SessionModeState | null;
}

export type ContextRef =
	| { id: string; kind: "file"; path: string; name: string }
	| { id: string; kind: "folder"; path: string; name: string }
	| { id: string; kind: "image"; name: string; mimeType: string; data: string }
	| { id: string; kind: "selection"; name: string; text: string; sourcePath: string | null };

export type ContextRefDraft =
	| { kind: "file"; path: string; name: string }
	| { kind: "folder"; path: string; name: string }
	| { kind: "image"; name: string; mimeType: string; data: string }
	| { kind: "selection"; name: string; text: string; sourcePath: string | null };

export interface SavedSession {
	id: string;
	sessionId: string;
	title: string;
	lastUsed: number;
	profileId: string;
}
