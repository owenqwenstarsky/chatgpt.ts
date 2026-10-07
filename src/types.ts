export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** A Codex response item. Unknown item variants are intentionally supported. */
export type ResponseItem = JsonObject;

export interface TextInputItem {
  type: "message";
  role: "user" | "developer" | "system" | "assistant";
  content: Array<{ type: "input_text" | "output_text"; text: string; [key: string]: JsonValue }>;
  [key: string]: JsonValue;
}

export interface Reasoning {
  effort?: string;
  summary?: "auto" | "concise" | "detailed" | string;
  [key: string]: JsonValue | undefined;
}

export interface ResponsesRequest {
  model: string;
  stream?: boolean;
  service_tier?: string;
  input: ResponseItem[];
  tools?: JsonValue[];
  tool_choice?: string | JsonObject;
  parallel_tool_calls?: boolean;
  reasoning?: Reasoning;
  store?: boolean;
  stream_options?: JsonObject;
  include?: string[];
  prompt_cache_key?: string;
  text?: JsonObject;
  client_metadata?: Record<string, string>;
  access_programs?: JsonValue;
  [key: string]: unknown;
}

export interface ResponsesOptions {
  sessionId?: string;
  threadId?: string;
  clientRequestId?: string;
  subagent?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface ResponseEvent {
  type?: string;
  [key: string]: unknown;
}

export interface ResponseResult extends ResponseEvent {
  id?: string;
  status?: string;
  output?: ResponseItem[];
  usage?: JsonObject;
}

export interface ModelInfo {
  slug: string;
  display_name: string;
  description?: string | null;
  default_reasoning_level?: string | null;
  supported_reasoning_levels?: JsonValue[];
  shell_type?: string;
  visibility?: string;
  supported_in_api?: boolean;
  priority?: number;
  [key: string]: unknown;
}

export interface ModelsResponse {
  models: ModelInfo[];
}
