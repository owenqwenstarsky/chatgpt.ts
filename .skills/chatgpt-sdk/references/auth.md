# Authentication

## Bearer tokens and custom providers

Use `new ChatGPTClient({ apiKey: token })` for an existing bearer token, or
`new ChatGPTClient({ auth: new BearerAuth(token) })`. `BearerAuth` rejects empty
or whitespace-only tokens. Validate required environment variables yourself;
the client does not read credentials from the environment automatically.

An `AuthProvider` implements `getHeaders(): Promise<HeadersInit>` and may
implement `invalidate(): void`. An application can supply its own provider to
include account headers or external credential management. Never send both
`apiKey` and `auth` to the client.

## OAuth and credential storage

```ts
import { ChatGPTClient, ChatGPTOAuth, FileCredentialStore } from "@owenqwenpersonal/chatgpt";

const auth = new ChatGPTOAuth({
  store: new FileCredentialStore("./.chatgpt/tokens.json"),
});
const client = new ChatGPTClient({ auth });
```

Construction does not log in. `getHeaders()` lazily loads stored credentials
and refreshes them when their nonzero `expiresAt` is within 60 seconds.
`expiresAt` is Unix time in milliseconds. Requests add `ChatGPT-Account-ID`
when stored tokens have `accountId`. OAuth token exchange does not derive an
account ID, so do not assume the SDK discovers it automatically.

`CredentialStore` has `load(): Promise<StoredTokens | undefined>`,
`save(tokens): Promise<void>`, and optional `clear(): Promise<void>`.
`StoredTokens` requires `accessToken` and may contain `refreshToken`, `expiresAt`,
`tokenType`, and `accountId`. A missing store keeps tokens in memory only.

`FileCredentialStore` writes JSON through a temporary file and atomic rename,
with file mode `0600` and newly created directory mode `0700`. Storage is not
encrypted and existing directory permissions are not tightened. Choose an
application-owned path and exclude it from source control.

For tests, use an in-memory store:

```ts
import { ChatGPTOAuth, type StoredTokens } from "@owenqwenpersonal/chatgpt";

let tokens: StoredTokens | undefined = { accessToken: "test-token" };
const auth = new ChatGPTOAuth({
  store: {
    load: async () => tokens,
    save: async value => { tokens = value; },
    clear: async () => { tokens = undefined; },
  },
});
```

## Interactive login

When authorized to initiate login, call `login()` without a configured
`redirectUri` to start an ephemeral loopback server on `127.0.0.1`:

```ts
await auth.login({
  open: url => { console.log("Open this login URL:", url.toString()); },
});
```

The `open` callback must open or present the URL to the user. The SDK does not
open a browser automatically. Login waits for the callback and has no built-in
timeout or abort option. Avoid starting an unattended login during tests.

For applications that own their callback, configure `redirectUri`, call
`authorizationUrl()`, retain its verifier and state privately per login attempt,
and redirect the user to the returned URL. In the callback, pass the received
code and state along with the retained verifier and expected state:

```ts
await auth.exchange(code, verifier, receivedState, expectedState, redirectUri);
```

State mismatch fails before exchange. The redirect URI must match the one used
to construct the authorization URL. `login()` with an explicit/configured
redirect URI does not manage an external callback; use these two methods instead.

`OAuthConfig` allows overrides for `clientId`, `authorizationEndpoint`,
`tokenEndpoint`, `scopes`, `redirectUri`, and `store`. Defaults use the SDK's
Codex client ID, `https://auth.openai.com/oauth/authorize`,
`https://auth.openai.com/oauth/token`, and
`openid profile email offline_access`. Do not infer registration or redirect
support from those constants; endpoint acceptance is external behavior.

## Refresh and failure handling

`refresh()` requires an in-memory refresh token; call `load()` first if invoking
it manually on a new auth instance. Concurrent refresh calls share a promise.
On a 401, the client invalidates OAuth expiry, refreshes, and retries the
request once. No interactive re-login occurs automatically.

Missing credentials or refresh tokens raise `AuthenticationError`. Invalid
state, failed token exchange/refresh, or invalid token responses raise
`OAuthError`. Store I/O and JSON errors may propagate directly. Handle failures
without dumping stored credentials or raw OAuth response bodies.

OAuth exchange/refresh use global `fetch`, independently of the client's
injected `fetch`. Mock global fetch with proper restoration for OAuth network
tests; injecting a client transport alone does not isolate them. Pure PKCE URL
and in-memory store tests require no live auth service or loopback server.
