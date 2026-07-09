/**
 * chat.js — Send messages to OpenAB via SSE fetch + ReadableStream.
 *
 *   sendMessage({ text, endpoint, token, onChunk, onDone, onError, signal })
 */

// SSE field-line parser: matches data:, event:, id:, retry: prefixes
const SSE_FIELD_RE = /^(data|event|id|retry):\s*(.*)$/i;

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

  // ── Fetch with 60s timeout ──
  const FETCH_TIMEOUT_MS = 60000;
  const timeoutController = new AbortController();
  let timeoutId;

  // Propagate external abort signal to our timeout controller
  if (signal) {
    if (signal.aborted) return;
    signal.addEventListener('abort', () => timeoutController.abort(signal.reason));
  }

  let response;
  try {
    timeoutId = setTimeout(() => timeoutController.abort(new Error('Request timeout')), FETCH_TIMEOUT_MS);

    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: timeoutController.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') return;
    onError?.(0, err.message || 'Network error');
    return;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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
  let lastId = '';
  let retryMs = 0;

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

        const match = trimmed.match(SSE_FIELD_RE);
        if (!match) continue;

        const [, field, value] = match;

        switch (field.toLowerCase()) {
          case 'event':
            // event: done → treat as stream end (even before data: [DONE])
            if (value === 'done') {
              reader.cancel();
              onDone?.(fullText);
              return;
            }
            break;

          case 'id':
            lastId = value;
            break;

          case 'retry':
            retryMs = parseInt(value, 10) || 0;
            break;

          case 'data': {
            // SSE end signal
            if (value === '[DONE]') {
              reader.cancel();
              onDone?.(fullText);
              return;
            }

            try {
              const parsed = JSON.parse(value);
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                onChunk?.(delta);
              }
            } catch {
              // skip unparseable data lines
            }
            break;
          }
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
