/**
 * main.js — Entry point. Wires VRM scene, chat, expression, settings together.
 */
import { initScene, loadVRM, getVRM, setBackgroundColor } from './vrm-scene.js';
import { parseAndApply } from './expression.js';
import { sendMessage } from './chat.js';
import { getSettings, saveSettings, saveModel, loadModel } from './settings.js';

/* ── State ────────────────────────────────────────────── */
let settings;
let streamingAbort = null;
let isStreaming = false;

/* ── DOM refs ─────────────────────────────────────────── */
const app          = document.getElementById('app');
const canvas       = document.getElementById('vrm-canvas');
const modelPrompt  = document.getElementById('model-prompt');
const fileInput    = document.getElementById('model-file-input');
const changeBtn    = document.getElementById('change-model-btn');
const statusDot    = document.getElementById('status-dot');
const statusText   = document.getElementById('status-text');
const messagesEl   = document.getElementById('messages');
const chatInput    = document.getElementById('chat-input');
const sendBtn      = document.getElementById('send-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsBtn  = document.getElementById('settings-btn');
const settingsClose = document.getElementById('settings-close');
const endpointInp  = document.getElementById('setting-endpoint');
const tokenInp     = document.getElementById('setting-token');
const bgColorInp   = document.getElementById('setting-bgcolor');
const saveSettingsBtn = document.getElementById('settings-save');

/* ── Init ─────────────────────────────────────────────── */

async function init() {
  try {
    settings = getSettings();

    // Scene
    initScene(canvas, settings.bgColor);

    // Apply saved background
    document.documentElement.style.setProperty('--bg', settings.bgColor);
    bgColorInp.value = settings.bgColor;

    // Settings form
    endpointInp.value = settings.endpoint;
    tokenInp.value = settings.token;

    // Load saved model or show file picker prompt
    const saved = await loadModel();
    if (saved && saved.data) {
      try {
        await loadVRM(saved.data, saved.name);
        modelPrompt.classList.add('hidden');
        setStatus('connected', 'Ready');
      } catch (err) {
        console.error('Failed to load saved model:', err);
        await tryLoadDefault();
      }
    } else {
      await tryLoadDefault();
    }

    // Resize handler
    window.addEventListener('resize', () => canvas.style.width = '');
  } catch (err) {
    console.error('Init error:', err);
    setStatus('error', 'Init failed: ' + err.message);
  }

  // Event wiring — always runs, even if init partially fails
  wireEvents();

  // Chat always available (model is optional)
  enableChat();
}

function wireEvents() {
  // Send
  sendBtn.addEventListener('click', handleSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Settings
  settingsBtn.addEventListener('click', () => settingsOverlay.classList.add('open'));
  settingsClose.addEventListener('click', () => settingsOverlay.classList.remove('open'));
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.classList.remove('open');
  });
  saveSettingsBtn.addEventListener('click', handleSaveSettings);

  // File picker
  fileInput.addEventListener('change', handleFilePick);
  changeBtn.addEventListener('click', () => fileInput.click());
}

/* ── Message Handling ─────────────────────────────────── */

async function handleSend() {
  const text = chatInput.value.trim();
  if (!text || isStreaming) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';

  addBubble('user', text);
  const assistantBubble = addBubble('assistant', '', true);
  const contentSpan = assistantBubble.querySelector('.content');
  const cursorSpan = assistantBubble.querySelector('.cursor');

  isStreaming = true;
  sendBtn.disabled = true;
  setStatus('connected', 'Typing…');

  const abort = new AbortController();
  streamingAbort = abort;

  let fullText = '';
  let lastExpressionCheck = '';

  await sendMessage({
    text,
    endpoint: settings.endpoint,
    token: settings.token,
    signal: abort.signal,
    onChunk(delta) {
      fullText += delta;
      contentSpan.textContent = fullText;

      // Apply expression on new complete sentences or every ~20 chars
      if (fullText.length - lastExpressionCheck.length > 20) {
        const vrm = getVRM();
        if (vrm) {
          parseAndApply(fullText, vrm);
        }
        lastExpressionCheck = fullText;
      }
      scrollBottom();
    },
    onDone() {
      // Final expression parse
      const vrm = getVRM();
      if (vrm) {
        const cleaned = parseAndApply(fullText, vrm);
        contentSpan.textContent = cleaned;
      }
      cursorSpan?.remove();
      assistantBubble.classList.remove('streaming');
      finishStream();
      setStatus('connected', 'Ready');
    },
    onError(code, msg) {
      if (code === 429) {
        addBubble('system', '⚠️ Server busy (429). Retrying in 3 seconds…');
        setTimeout(() => handleSend(), 3000);
      } else {
        addBubble('error', `Error (${code}): ${msg}`);
      }
      cursorSpan?.remove();
      assistantBubble.classList.remove('streaming');
      finishStream();
      setStatus('error', code ? `Error ${code}` : 'Disconnected');
    },
  });
}

function finishStream() {
  isStreaming = false;
  sendBtn.disabled = false;
  streamingAbort = null;
  chatInput.focus();
}

/* ── Bubble Helpers ───────────────────────────────────── */

function addBubble(role, content = '', streaming = false) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  if (streaming) {
    el.classList.add('streaming');
    const contentSpan = document.createElement('span');
    contentSpan.className = 'content';
    contentSpan.textContent = content;
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    el.appendChild(contentSpan);
    el.appendChild(cursor);
  } else {
    el.textContent = content;
  }
  messagesEl.appendChild(el);
  scrollBottom();
  return el;
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ── Settings ─────────────────────────────────────────── */

function handleSaveSettings() {
  const newEndpoint = endpointInp.value.trim() || settings.endpoint;
  const newToken = tokenInp.value.trim();
  const newBg = bgColorInp.value || settings.bgColor;

  saveSettings({ endpoint: newEndpoint, token: newToken, bgColor: newBg });
  settings = getSettings();

  document.documentElement.style.setProperty('--bg', newBg);
  setBackgroundColor(newBg);

  settingsOverlay.classList.remove('open');
  setStatus('connected', 'Settings saved');
}

/* ── File Picker ──────────────────────────────────────── */

async function handleFilePick(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.name.endsWith('.vrm')) {
    setStatus('error', 'Please select a .vrm file');
    return;
  }

  setStatus('connected', `Loading ${file.name}…`);
  try {
    const buf = await file.arrayBuffer();
    await loadVRM(buf, file.name);
    await saveModel(file);
    modelPrompt.classList.add('hidden');
    setStatus('connected', 'Ready');
    enableChat();
  } catch (err) {
    console.error(err);
    setStatus('error', `Failed to load: ${err.message}`);
  }
}

/** Load the bundled default model (Alicia Solid). */
async function tryLoadDefault() {
  try {
    const resp = await fetch('models/AliciaSolid.vrm');
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      await loadVRM(buf, 'AliciaSolid.vrm');
      modelPrompt.classList.add('hidden');
      setStatus('connected', 'Ready');
      return;
    }
    console.warn('Default model not found (HTTP ' + resp.status + ')');
  } catch (err) {
    console.warn('Default model load failed:', err.message);
  }
  modelPrompt.classList.remove('hidden');
  setStatus('error', 'No model loaded');
}

function enableChat() {
  chatInput.disabled = false;
  sendBtn.disabled = false;
  chatInput.placeholder = 'Type a message…';
}

/* ── Status ───────────────────────────────────────────── */

function setStatus(state, msg) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = msg;
}

/* ── Start ────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', init);
