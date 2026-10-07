export class ChatGPTError extends Error {
  readonly status?: number;
  readonly requestId?: string;
  readonly body?: unknown;

  constructor(message: string, options: { status?: number; requestId?: string; body?: unknown } = {}) {
    super(message);
    this.name = "ChatGPTError";
    this.status = options.status;
    this.requestId = options.requestId;
    this.body = options.body;
  }
}

export class AuthenticationError extends ChatGPTError {
  constructor(message: string, options: { status?: number; body?: unknown } = {}) {
    super(message, options);
    this.name = "AuthenticationError";
  }
}

export class OAuthError extends ChatGPTError {
  constructor(message: string, options: { status?: number; body?: unknown } = {}) {
    super(message, options);
    this.name = "OAuthError";
  }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(code|token|refresh_token|access_token|client_secret)=([^&\s]+)/gi, "$1=<redacted>")
    .replace(/Bearer\s+[^\s,]+/gi, "Bearer <redacted>");
}
