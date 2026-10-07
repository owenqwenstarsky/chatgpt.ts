# API usage

## Client and requests

```ts
import { ChatGPTClient, type ResponsesRequest } from "@owenqwenpersonal/chatgpt";

const token = process.env.CHATGPT_TOKEN;
const model = process.env.CHATGPT_MODEL;
if (!token || !model) throw new Error("CHATGPT_TOKEN and CHATGPT_MODEL are required");

const client = new ChatGPTClient({ apiKey: token });
const request: ResponsesRequest = {
  model,
  input: [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Explain this function." }],
  }],
};
const response = await client.responses.create(request);
```

`ChatGPTClient` accepts `apiKey` or `auth` (not both), `baseURL`, `clientVersion`,
`headers`, and `fetch`. `apiKey` is a bearer token for the chosen endpoint; the
name does not imply an OpenAI platform API key works on the default backend.
Headers merge in this order: client defaults, request headers, auth headers.
Authentication therefore takes precedence over an `Authorization` request header.

`ResponsesRequest` requires `model: string` and `input: ResponseItem[]`.
`ResponseItem` is a JSON object that permits unknown variants. Optional fields
include `tools`, `tool_choice`, `parallel_tool_calls`, `reasoning`, `store`,
`include`, `service_tier`, `prompt_cache_key`, `text`, and `client_metadata`.
Permissive types do not establish backend support. Tool execution and any tool
result continuation belong to the application, not the SDK.

Both response methods POST to `/responses` with `stream: true`, including when
the caller supplies `stream: false`. Nullish defaults are `tool_choice: "auto"`,
`parallel_tool_calls: true`, `reasoning: null`, `store: false`, and `include: []`.
Explicit non-null values for those fields are retained.

## Streaming and collected output

```ts
for await (const event of client.responses.stream(request)) {
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
    process.stdout.write(event.delta);
  } else if (event.type === "response.failed" || event.type === "error") {
    throw new Error("Response failed");
  }
}
```

`stream()` yields parsed JSON SSE events and ignores `[DONE]`. Events are open
objects; narrow unknown properties before use. It does not turn API error events
into exceptions itself. Transport errors and invalid SSE JSON do throw.

`create()` uses the exported `collectResponse()` helper: it returns the last
`response.completed` or `response.done` response, throws `ChatGPTError` for
`response.failed` or `error`, and returns `{}` if no terminal result arrives.
Do not treat that empty object as a confirmed successful response.

`ResponseResult` exposes optional `id`, `status`, `output`, and `usage`. Extract
text by inspecting output messages and their content:

```ts
const text = (response.output ?? []).flatMap(item => {
  if (item.type !== "message" || !Array.isArray(item.content)) return [];
  return item.content.flatMap(part => {
    if (part === null || typeof part !== "object" || Array.isArray(part)) return [];
    return part.type === "output_text" && typeof part.text === "string" ? [part.text] : [];
  });
}).join("");
```

## Request options and models

Both response methods take a second `ResponsesOptions` argument:

| Option | Behavior |
| --- | --- |
| `signal` | Passes an `AbortSignal` to the request |
| `headers` | Per-request headers |
| `sessionId` | Sets `session-id` |
| `threadId` | Sets `thread-id`, and defaults `x-client-request-id` to this value |
| `clientRequestId` | Sets `x-client-request-id`, overriding the thread default |
| `subagent` | Sets `x-openai-subagent` |

These headers are metadata; do not assume they replace conversation input or
provide server-side history retention.

`await client.models.list({ signal, headers })` returns `ModelInfo[]` from
`/models?client_version=...`. The default client version is `0.1.0`.
Entries use `slug` and `display_name`, not an OpenAI-style `data[].id` envelope.
Use catalog metadata to inform model selection while preserving the user's choice.

## Errors and offline testing

`ChatGPTError` exposes optional `status`, `requestId`, and `body`.
`AuthenticationError` and `OAuthError` extend it. Error bodies can contain
sensitive data; prefer logging status and request ID. Network errors can remain
native fetch errors. There is no generic rate-limit or network retry policy.
Response/model requests retry once after a 401 only when the auth provider
implements `refresh()`; static bearer auth cannot refresh.

Inject `fetch` for response/model tests without network access:

```ts
import assert from "node:assert/strict";
import { ChatGPTClient } from "@owenqwenpersonal/chatgpt";

const client = new ChatGPTClient({
  apiKey: "test-token",
  fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "test-model");
    assert.equal(body.stream, true);
    return new Response(
      'data: {"type":"response.completed","response":{"id":"test-response","output":[]}}\n\n' +
      'data: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
const result = await client.responses.create({ model: "test-model", input: [] });
assert.equal(result.id, "test-response");
```

Use `parseSSE(response)` and `collectResponse(events)` directly when testing
transport parsing or aggregation. Mock HTTP failure, error events, and aborts
as needed for the application's behavior.
