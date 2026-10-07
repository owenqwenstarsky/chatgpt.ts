import test from "node:test";
import assert from "node:assert/strict";
import { ChatGPTClient, DEFAULT_BASE_URL, ChatGPTOAuth, type StoredTokens } from "../dist/index.js";

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...init });
}

test("uses the Codex base URL and exact request shape", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const client = new ChatGPTClient({ apiKey: "secret", fetch: async (url, init) => { seen = { url: String(url), init: init ?? {} }; return response("data: {\"type\":\"response.completed\",\"response\":{\"id\":\"r1\"}}\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }); } });
  const result = await client.responses.create({ model: "gpt-test", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] });
  assert.equal(DEFAULT_BASE_URL, "https://chatgpt.com/backend-api/codex");
  assert.equal(seen?.url, `${DEFAULT_BASE_URL}/responses`);
  assert.equal(new Headers(seen?.init.headers).get("authorization"), "Bearer secret");
  assert.equal((result as { id?: string }).id, "r1");
  const payload = JSON.parse(String(seen?.init.body));
  assert.equal(payload.model, "gpt-test");
  assert.equal(payload.stream, true);
  assert.equal(payload.reasoning, null);
  assert.deepEqual(payload.input[0].content[0], { type: "input_text", text: "hello" });
});

test("adds Codex session and thread headers", async () => {
  let seen: RequestInit | undefined;
  const client = new ChatGPTClient({ auth: { getHeaders: async () => ({} as HeadersInit) }, fetch: async (_url, init) => { seen = init; return response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }); } });
  for await (const _event of client.responses.stream({ model: "m", input: [] }, { sessionId: "s", threadId: "t", subagent: "review" })) { /* consume */ }
  const headers = new Headers(seen?.headers);
  assert.equal(headers.get("session-id"), "s");
  assert.equal(headers.get("thread-id"), "t");
  assert.equal(headers.get("x-client-request-id"), "t");
  assert.equal(headers.get("x-openai-subagent"), "review");
});

test("parses split SSE frames and ignores DONE", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode("data: {\"type\":\"response.output_text.delta\",\"delta\":\"hel")); controller.enqueue(encoder.encode("lo\"}\n\ndata: [DONE]\n\n")); controller.close(); },
  });
  const client = new ChatGPTClient({ apiKey: "x", fetch: async () => new Response(stream, { headers: { "content-type": "text/event-stream" } }) });
  const events = [];
  for await (const event of client.responses.stream({ model: "m", input: [] })) events.push(event);
  assert.deepEqual(events, [{ type: "response.output_text.delta", delta: "hello" }]);
});

test("builds PKCE OAuth URLs without exposing verifier in the URL", () => {
  const auth = new ChatGPTOAuth({ redirectUri: "http://127.0.0.1/callback" });
  const request = auth.authorizationUrl();
  assert.equal(request.url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(request.url.searchParams.get("code_challenge"));
  assert.ok(request.state.length > 20);
  assert.equal(request.url.searchParams.get("code_verifier"), null);
});

test("uses a custom base URL and client version for models", async () => {
  let seen = "";
  const client = new ChatGPTClient({ baseURL: "https://proxy.example/api/", clientVersion: "9.2.1", apiKey: "x", fetch: async url => { seen = String(url); return response({ models: [{ slug: "m", display_name: "Model" }] }); } });
  assert.deepEqual(await client.models.list(), [{ slug: "m", display_name: "Model" }]);
  assert.equal(seen, "https://proxy.example/api/models?client_version=9.2.1");
});

test("file-independent token stores can be used by OAuth", async () => {
  const saved: StoredTokens[] = [];
  const store = { load: async () => saved[0], save: async (tokens: StoredTokens) => { saved[0] = tokens; } };
  const auth = new ChatGPTOAuth({ store });
  assert.equal(await auth.load(), undefined);
  await store.save({ accessToken: "a" });
  assert.equal((await store.load())?.accessToken, "a");
});
