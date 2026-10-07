---
name: chatgpt-sdk
description: Integrate @owenqwenpersonal/chatgpt into Node.js or TypeScript applications, including ChatGPT bearer/OAuth authentication, Codex Responses streaming, model discovery, and mocked transport tests. Use for this package rather than the official OpenAI SDK.
---

# ChatGPT SDK

Use `@owenqwenpersonal/chatgpt` in Node.js 20+ applications. Install it with
`npm install @owenqwenpersonal/chatgpt` and import its exports using ESM.
This skill describes version 0.1.0; check the installed package's declarations
when using another version.

## Integration workflow

- Read [API usage](references/api.md) for client options, responses, streaming,
  model discovery, errors, and in-memory transport testing.
- Read [Authentication](references/auth.md) when configuring bearer tokens,
  OAuth login/refresh, custom auth providers, or credential storage.
- Use the application's chosen model explicitly; the SDK has no default model.
  Do not assume a hardcoded model slug or reasoning level is available.
- The default base URL is `https://chatgpt.com/backend-api/codex`. Set `baseURL`
  to the compatible proxy's API root when requested; the SDK appends
  `/responses` or `/models`. This is a Codex-shaped transport, so do not assume
  that arbitrary official OpenAI API features work on its backend.
- `responses.create()` collects an SSE response; both response methods force
  `stream: true` on the wire. Results have `output`, not an `output_text` helper.
- Use environment variables or an application-owned credential store. Keep
  tokens, refresh tokens, PKCE verifiers, and sensitive error bodies out of
  logs, source control, and client-side bundles.
- Test integrations with mocked `fetch` and in-memory credentials. Live requests,
  interactive login, or production credentials need the user's authorization;
  creating integration code alone does not authorize those actions.

## Global installation

The whole directory is self-contained and ships in the npm package. From an
application with the package installed, copy it into one global skill root:

```sh
mkdir -p "$HOME/.codex/skills"
cp -R node_modules/@owenqwenpersonal/chatgpt/.skills/chatgpt-sdk "$HOME/.codex/skills/"
```

For the shared `~/.agents/skills` root, substitute that root in both commands.
From the SDK repository, use `.skills/chatgpt-sdk` as the copy source.
Inspect an existing destination before replacing it to preserve local edits.

Alternatively, from a stable repository checkout and with no existing destination:

```sh
mkdir -p "$HOME/.codex/skills"
ln -s "$PWD/.skills/chatgpt-sdk" "$HOME/.codex/skills/chatgpt-sdk"
```

Install into one root to avoid duplicates. A symlink tracks checkout updates
and requires that checkout to remain in place; a copy must be updated manually.
Invoke the installed skill as `$chatgpt-sdk`; automatic selection remains enabled.
