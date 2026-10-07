# `@owenqwenpersonal/chatgpt`

Small Node.js 20+ TypeScript client for the Codex-shaped ChatGPT Responses API.
It uses `https://chatgpt.com/backend-api/codex` by default and accepts any custom
base URL for a proxy or compatible deployment.

```ts
import { ChatGPTClient } from "@owenqwenpersonal/chatgpt";

const client = new ChatGPTClient({ apiKey: process.env.CHATGPT_TOKEN });
const response = await client.responses.create({
  model: "gpt-5-codex",
  input: [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Explain this function." }],
  }],
});
```

Streaming returns parsed Codex SSE events:

```ts
for await (const event of client.responses.stream(request)) {
  if (event.type === "response.output_text.delta") process.stdout.write(String(event.delta));
}
```

Use `ChatGPTOAuth` with a `CredentialStore` when the SDK should own ChatGPT
OAuth refresh. `authorizationUrl()` and `exchange()` support applications that
already own their callback; `login()` starts a loopback callback server.

```ts
import { ChatGPTClient, ChatGPTOAuth, FileCredentialStore } from "@owenqwenpersonal/chatgpt";

const auth = new ChatGPTOAuth({
  store: new FileCredentialStore("./.chatgpt/tokens.json"),
});
const client = new ChatGPTClient({ auth });
```

`client.models.list()` calls the Codex `/models?client_version=...` endpoint.
The SDK does not make live requests during its test suite; provide a custom
`fetch` implementation for tests or specialized transports.

## Agent skill

The npm package includes a self-contained `chatgpt-sdk` skill with API and
authentication references. After installing the SDK in your project, install
the skill globally for Codex:

```sh
mkdir -p "$HOME/.codex/skills"
cp -R node_modules/@owenqwenpersonal/chatgpt/.skills/chatgpt-sdk "$HOME/.codex/skills/"
```

To use the shared `~/.agents/skills` root, substitute that root in both commands.
Install into one root to avoid duplicate discovery. Inspect any existing
`chatgpt-sdk` destination before copying an update to preserve local edits.

From this repository, copy `.skills/chatgpt-sdk` instead, or symlink it from a
stable checkout when the destination does not already exist:

```sh
mkdir -p "$HOME/.codex/skills"
ln -s "$PWD/.skills/chatgpt-sdk" "$HOME/.codex/skills/chatgpt-sdk"
```

Copies need manual updates; symlinks track the checkout and require it to stay
in place. Invoke the installed skill as `$chatgpt-sdk`, or let the agent select
it automatically for SDK integration tasks.
