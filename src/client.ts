import { AuthenticationError, ChatGPTError } from "./errors.js";
import type { AuthProvider } from "./auth.js";
import { collectResponse, parseSSE } from "./sse.js";
import type { ModelInfo, ModelsResponse, ResponseEvent, ResponseResult, ResponsesOptions, ResponsesRequest } from "./types.js";

export const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const DEFAULT_CLIENT_VERSION = "0.1.0";

export interface ChatGPTClientOptions {
  apiKey?: string;
  auth?: AuthProvider;
  baseURL?: string;
  clientVersion?: string;
  headers?: HeadersInit;
  fetch?: typeof globalThis.fetch;
}

export class ChatGPTClient {
  readonly baseURL: string;
  readonly responses: ResponsesResource;
  readonly models: ModelsResource;
  readonly clientVersion: string;
  private readonly auth?: AuthProvider;
  private readonly defaultHeaders: Headers;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ChatGPTClientOptions = {}) {
    if (options.apiKey && options.auth) throw new AuthenticationError("Specify either apiKey or auth, not both");
    this.baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.clientVersion = options.clientVersion ?? DEFAULT_CLIENT_VERSION;
    this.auth = options.auth ?? (options.apiKey ? { getHeaders: async () => ({ Authorization: `Bearer ${options.apiKey}` }) } : undefined);
    this.defaultHeaders = new Headers(options.headers);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new ChatGPTError("No fetch implementation is available");
    this.responses = new ResponsesResource(this);
    this.models = new ModelsResource(this);
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(this.defaultHeaders);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (this.auth) new Headers(await this.auth.getHeaders()).forEach((value, key) => headers.set(key, value));
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await this.fetchImpl(`${this.baseURL}/${path.replace(/^\/+/, "")}`, { ...init, headers });
    if (!response.ok) {
      const bodyText = await response.text();
      let body: unknown; try { body = bodyText ? JSON.parse(bodyText) : undefined; } catch { body = bodyText.slice(0, 2000); }
      const requestId = response.headers.get("x-request-id") ?? undefined;
      if (response.status === 401 && this.auth?.invalidate) this.auth.invalidate();
      throw new ChatGPTError(`ChatGPT API request failed (${response.status})`, { status: response.status, requestId, body });
    }
    return response;
  }

  async requestWithRefresh(path: string, init: RequestInit, retry = true): Promise<Response> {
    try { return await this.request(path, init); }
    catch (error) {
      if (retry && error instanceof ChatGPTError && error.status === 401 && this.auth && "refresh" in this.auth && typeof (this.auth as { refresh?: () => Promise<void> }).refresh === "function") {
        await (this.auth as { refresh: () => Promise<void> }).refresh();
        return this.requestWithRefresh(path, init, false);
      }
      throw error;
    }
  }
}

class ResponsesResource {
  constructor(private readonly client: ChatGPTClient) {}
  async create(request: ResponsesRequest, options: ResponsesOptions = {}): Promise<ResponseResult> {
    const events = this.stream(request, options);
    return collectResponse(events);
  }
  async *stream(request: ResponsesRequest, options: ResponsesOptions = {}): AsyncGenerator<ResponseEvent> {
    const headers = new Headers(options.headers);
    headers.set("accept", "text/event-stream");
    if (options.sessionId) headers.set("session-id", options.sessionId);
    if (options.threadId) { headers.set("thread-id", options.threadId); headers.set("x-client-request-id", options.clientRequestId ?? options.threadId); }
    else if (options.clientRequestId) headers.set("x-client-request-id", options.clientRequestId);
    if (options.subagent) headers.set("x-openai-subagent", options.subagent);
    const payload = { ...request, stream: true, tool_choice: request.tool_choice ?? "auto", parallel_tool_calls: request.parallel_tool_calls ?? true, reasoning: request.reasoning ?? null, store: request.store ?? false, include: request.include ?? [] };
    const response = await this.client.requestWithRefresh("responses", { method: "POST", headers, body: JSON.stringify(payload), signal: options.signal });
    yield* parseSSE(response);
  }
}

class ModelsResource {
  constructor(private readonly client: ChatGPTClient) {}
  async list(options: { signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<ModelInfo[]> {
    const url = `models?client_version=${encodeURIComponent(this.client.clientVersion)}`;
    const response = await this.client.requestWithRefresh(url, { method: "GET", headers: options.headers, signal: options.signal });
    const data = await response.json() as ModelsResponse;
    if (!data || !Array.isArray(data.models)) throw new ChatGPTError("The models endpoint returned an invalid catalog");
    return data.models;
  }
}
