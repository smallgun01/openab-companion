/**
 * chat.js — Send messages to OpenAB via SSE fetch + ReadableStream.
 *
 *   sendMessage({ text, endpoint, token, onChunk, onDone, onError, signal })
 */

const SSE_LINE_RE = /^data:\s*(.*)$/;

/**
 * Send a chat message to OpenAB and stream the response.
 *
 * @param {Object} opts
 * @param {string} opts.text           — user message
 * @param {string} opts.endpoint       — full URL, e.g. http://localhost:8080/v1/chat/completions
 * @param {string} opts.token          — Bearer token (can be '')
 * @param {(content:string)=>void} opts.onChunk — called with each delta text chunk
 * @param {(fullText:string)=>void} opts.onDone — called when stream completes
 * @param {(code:number, message:string)=>void} opts.onError
 * @param {AbortSignal} [opts.signal]  — optional AbortController signal
 */
export async function sendMessage({ text, endpoint, token, onChunk, onDone, onError, signal }) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const body = JSON.stringify({
    model: 'default',
    messages: [{ role: 'user', content: text }],
    stream: true,
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError?.(0, err.message || 'Network error');
    return;
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { /* ignore */ }
    onError?.(response.status, detail || `HTTP ${response.status}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError?.(response.status, 'Response body is not readable');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const match = trimmed.match(SSE_LINE_RE);
        if (!match) continue;

        const data = match[1];

        // SSE end signal
        if (data === '[DONE]') {
          reader.cancel();
          onDone?.(fullText);
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk?.(delta);
          }
        } catch {
          // skip unparseable data lines
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError?.(0, err.message);
    return;
  }

  // Stream ended without [DONE]
  onDone?.(fullText);
}
