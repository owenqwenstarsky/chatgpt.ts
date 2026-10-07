import { ChatGPTError } from "./errors.js";
import type { ResponseEvent, ResponseResult } from "./types.js";

export async function* parseSSE(response: Response): AsyncGenerator<ResponseEvent> {
  if (!response.body) throw new ChatGPTError("Responses request returned no stream body", { status: response.status });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData: string[] = [];
  const flush = async function* (): AsyncGenerator<ResponseEvent> {
    if (!eventData.length) return;
    const data = eventData.join("\n");
    eventData = [];
    if (data === "[DONE]") return;
    try { yield JSON.parse(data) as ResponseEvent; }
    catch { throw new ChatGPTError("The Responses SSE stream contained invalid JSON"); }
  };
  while (true) {
    const next = await reader.read();
    buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") { for await (const event of flush()) yield event; continue; }
      if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart());
    }
    if (next.done) break;
  }
  if (buffer.trim()) { if (buffer.startsWith("data:")) eventData.push(buffer.slice(5).trimStart()); }
  for await (const event of flush()) yield event;
}

export async function collectResponse(events: AsyncIterable<ResponseEvent>): Promise<ResponseResult> {
  let result: ResponseResult | undefined;
  for await (const event of events) {
    if (event.type === "response.completed" || event.type === "response.done") result = (event.response as ResponseResult | undefined) ?? event as ResponseResult;
    else if (event.type === "response.failed" || event.type === "error") throw new ChatGPTError("The Responses API reported an error", { body: event });
  }
  return result ?? {};
}
