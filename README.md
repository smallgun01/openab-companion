# OpenAB Companion

> Give OpenAB a face — lightweight web VRM character chat interface.

A zero-build-step single-page app: vanilla JS + three.js + @pixiv/three-vrm, talking to an OpenAB backend via SSE streaming.

---

## Quick Start

```bash
cd openab-companion
npx serve .
# or: python3 -m http.server 8000
```

Open `http://localhost:3000` (or `:8000`).

1. Load a `.vrm` model via the file picker (persisted in IndexedDB)
2. Configure your OpenAB endpoint + token in Settings (⚙️)
3. Start chatting — responses stream in with expressive VRM animations

---

## Architecture

```
Browser                         Backend
┌─────────────────────────┐     ┌──────────────────┐
│ VRM Scene   Chat UI     │────▶│ OpenAB Gateway   │
│ (THREE.js)  (SSE fetch) │     │ VTuber Adapter   │
│                          │     │ Persistent ACP   │
│ expression  settings    │     └──────────────────┘
│ parser      (localStg)  │
└─────────────────────────┘
```

- **VRM scene**: three.js canvas with idle animations (breathing + blinking)
- **Chat**: SSE streaming via `fetch()` + `ReadableStream`
- **Expressions**: `[happy]`, `[sad]`, `[angry]`, etc. parsed from responses, lerp-applied to VRM
- **Settings**: endpoint/token in localStorage, model binary in IndexedDB

---

## File Structure

```
openab-companion/
├── index.html          # Entry point
├── css/
│   └── style.css       # All styles
├── js/
│   ├── main.js         # Init + wire modules
│   ├── vrm-scene.js    # THREE scene, VRM load, idle anim
│   ├── expression.js   # [emotion] parser + VRM control
│   ├── chat.js         # SSE fetch + stream parser
│   └── settings.js     # localStorage + IndexedDB
├── models/             # Place .vrm files here
├── README.md
└── LICENSE
```

---

## Dependencies (CDN)

```js
three@0.170
@pixiv/three-vrm@3
```

All imported as ES modules from jsDelivr. No npm, no bundler, no node_modules.

---

## Supported Emotion Tags

| Tag | Expression |
|-----|-----------|
| `[happy]` | Happy |
| `[sad]` | Sad |
| `[angry]` | Angry |
| `[surprised]` | Surprised |
| `[relaxed]` | Relaxed |
| `[thinking]` | Neutral |
| `[confused]` | Sad + Surprised blend |
| `[excited]` | Happy + Surprised blend |
| `[neutral]` | Neutral |

Tags are stripped from displayed text and applied with 300ms lerp transitions.

---

## API Format

```json
POST /v1/chat/completions
{
  "model": "default",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": true
}
```

Only the latest user message is sent. History is maintained by the OpenAB persistent ACP session.

---

## License

**Code**: MIT

**Default model** (`models/AliciaSolid.vrm`): ニコニ立体ちゃん（Alicia Solid）by Dwango Co., Ltd.
Licensed under the [ニコニ立体ちゃんライセンス](https://3d.nicovideo.jp/alicia/rule.html).
Free to use, modify, and redistribute (non-corporate). No attribution required.
