import { createServer, type Server } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AuthenticationError, OAuthError, redactSecrets } from "./errors.js";

export interface AuthProvider {
  getHeaders(): Promise<HeadersInit>;
  invalidate?(): void;
}

export class BearerAuth implements AuthProvider {
  constructor(readonly token: string) {
    if (!token.trim()) throw new AuthenticationError("A bearer token is required");
  }
  async getHeaders(): Promise<HeadersInit> { return { Authorization: `Bearer ${this.token}` }; }
}

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  accountId?: string;
  [key: string]: unknown;
}

export interface CredentialStore {
  load(): Promise<StoredTokens | undefined>;
  save(tokens: StoredTokens): Promise<void>;
  clear?(): Promise<void>;
}

export class FileCredentialStore implements CredentialStore {
  constructor(readonly path: string) {}
  async load(): Promise<StoredTokens | undefined> {
    try { return JSON.parse(await readFile(this.path, "utf8")) as StoredTokens; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  async save(tokens: StoredTokens): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.path);
  }
  async clear(): Promise<void> { try { await (await import("node:fs/promises")).unlink(this.path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}

export interface OAuthConfig {
  clientId?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  scopes?: string[];
  redirectUri?: string;
  store?: CredentialStore;
}

const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_AUTHORIZATION_ENDPOINT = "https://auth.openai.com/oauth/authorize";
const DEFAULT_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access"];

function base64Url(data: Uint8Array): string { return Buffer.from(data).toString("base64url"); }
function createPkce() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export class ChatGPTOAuth implements AuthProvider {
  private tokens?: StoredTokens;
  private refreshPromise?: Promise<void>;
  readonly config: Required<Pick<OAuthConfig, "clientId" | "authorizationEndpoint" | "tokenEndpoint" | "scopes">> & OAuthConfig;

  constructor(config: OAuthConfig = {}) {
    this.config = {
      clientId: config.clientId ?? DEFAULT_CLIENT_ID,
      authorizationEndpoint: config.authorizationEndpoint ?? DEFAULT_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
      scopes: config.scopes ?? DEFAULT_SCOPES,
      ...config,
    };
  }

  async getHeaders(): Promise<HeadersInit> {
    await this.ensureTokens();
    if (!this.tokens?.accessToken) throw new AuthenticationError("ChatGPT OAuth authentication is not configured; call login() first");
    const headers: Record<string, string> = { Authorization: `${this.tokens.tokenType ?? "Bearer"} ${this.tokens.accessToken}` };
    if (this.tokens.accountId) headers["ChatGPT-Account-ID"] = this.tokens.accountId;
    return headers;
  }

  invalidate(): void { if (this.tokens) this.tokens = { ...this.tokens, expiresAt: 0 }; }

  async load(): Promise<StoredTokens | undefined> { this.tokens = await this.config.store?.load(); return this.tokens; }

  authorizationUrl(options: { redirectUri?: string } = {}): { url: URL; verifier: string; state: string } {
    const redirectUri = options.redirectUri ?? this.config.redirectUri;
    if (!redirectUri) throw new OAuthError("redirectUri is required to create an OAuth authorization URL");
    const { verifier, challenge } = createPkce();
    const state = base64Url(randomBytes(32));
    const url = new URL(this.config.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", this.config.scopes.join(" "));
    return { url, verifier, state };
  }

  async exchange(code: string, verifier: string, state: string, expectedState: string, redirectUri?: string): Promise<StoredTokens> {
    if (state !== expectedState) throw new OAuthError("OAuth callback state did not match");
    const uri = redirectUri ?? this.config.redirectUri;
    if (!uri) throw new OAuthError("redirectUri is required for token exchange");
    const response = await fetch(this.config.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: this.config.clientId, code, redirect_uri: uri, code_verifier: verifier }) });
    const body = await parseJson(response);
    if (!response.ok) throw new OAuthError(`OAuth code exchange failed (${response.status})`, { status: response.status, body });
    return this.setTokens(tokenResponse(body));
  }

  async refresh(): Promise<void> {
    if (!this.tokens?.refreshToken) throw new AuthenticationError("No ChatGPT OAuth refresh token is available");
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const response = await fetch(this.config.tokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: this.config.clientId, refresh_token: this.tokens!.refreshToken! }) });
      const body = await parseJson(response);
      if (!response.ok) throw new OAuthError(`OAuth token refresh failed (${response.status})`, { status: response.status, body });
      await this.setTokens({ ...this.tokens, ...tokenResponse(body), refreshToken: tokenResponse(body).refreshToken ?? this.tokens!.refreshToken });
    })().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  async login(options: { open?: (url: URL) => Promise<void> | void; redirectUri?: string } = {}): Promise<StoredTokens> {
    const redirectUri = options.redirectUri ?? this.config.redirectUri;
    let server: Server | undefined;
    let callbackUri = redirectUri;
    let callback: Promise<{ code: string; state: string }> | undefined;
    if (!callbackUri) {
      server = createServer();
      await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (!address || typeof address === "string") throw new OAuthError("Could not start OAuth callback server");
      callbackUri = `http://127.0.0.1:${address.port}/oauth/callback`;
      callback = new Promise((resolve, reject) => server!.on("request", (request, response) => {
        try { const url = new URL(request.url ?? "/", callbackUri); const code = url.searchParams.get("code"); const state = url.searchParams.get("state"); if (!code || !state) throw new OAuthError("OAuth callback did not include code and state"); response.end("Authentication complete. You may close this window."); resolve({ code, state }); } catch (error) { response.statusCode = 400; response.end("Authentication failed."); reject(error); }
      }));
    }
    try {
      const request = this.authorizationUrl({ redirectUri: callbackUri });
      await options.open?.(request.url);
      if (!options.open && process.platform === "darwin") { /* host applications may open request.url */ }
      const result = callback ? await callback : await Promise.reject(new OAuthError("A callback is required when redirectUri is supplied; use authorizationUrl() and exchange()"));
      return await this.exchange(result.code, request.verifier, result.state, request.state, callbackUri);
    } catch (error) { throw error instanceof OAuthError ? error : new OAuthError(redactSecrets(String(error))); }
    finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); }
  }

  private async ensureTokens(): Promise<void> {
    if (!this.tokens) await this.load();
    if (this.tokens?.expiresAt && this.tokens.expiresAt <= Date.now() + 60_000) await this.refresh();
  }
  private async setTokens(tokens: StoredTokens): Promise<StoredTokens> { this.tokens = tokens; await this.config.store?.save(tokens); return tokens; }
}

function tokenResponse(body: unknown): StoredTokens {
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).access_token !== "string") throw new OAuthError("OAuth server returned an invalid token response");
  const value = body as Record<string, unknown>;
  return { accessToken: value.access_token as string, refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : undefined, expiresAt: typeof value.expires_in === "number" ? Date.now() + value.expires_in * 1000 : undefined, tokenType: typeof value.token_type === "string" ? value.token_type : "Bearer" };
}
async function parseJson(response: Response): Promise<unknown> { const text = await response.text(); try { return text ? JSON.parse(text) : undefined; } catch { return { message: text.slice(0, 1000) }; } }
