# OpenAB Companion

> Give OpenAB a face — lightweight web VRM character chat interface.

1,734 lines of vanilla JS. Zero build steps. Two CDN dependencies. Talking to an OpenAB backend via SSE streaming.

---

## Quick Start

```bash
node dev-server.mjs
# Open http://localhost:8011
```

1. Load a `.vrm` model via the file picker (persisted in IndexedDB)
2. Configure your OpenAB endpoint + token in Settings (⚙️)
3. Start chatting — responses stream in with expressive VRM animations

---

## Architecture

```
Browser                                   Backend
┌──────────────────────────────────┐     ┌──────────────────┐
│ main.js                          │────▶│ OpenAB Gateway    │
│  ├── vrm-scene.js  3D rendering │     │ (your-gateway.example.com)      │
│  ├── chat.js       SSE stream   │     │ /v1/chat/complete │
│  ├── expression.js emotion tags │     └──────────────────┘
│  ├── animation.js  bone clips   │
│  └── settings.js   persistence  │
└──────────────────────────────────┘
```

- **VRM Scene**: THREE.js canvas with idle animations (breathing, head sway, blinking)
- **Chat**: SSE streaming via `fetch()` + `ReadableStream` — full `event:`/`id:`/`retry:`/`data:` field parser
- **Expressions**: 19 emotion tags (`[happy]`, `[sad]`, `[angry]`, `[surprised]`, `[relaxed]`, `[thinking]`, `[confused]`, `[excited]`, `[neutral]`, plus blends) parsed from responses, lerp-applied to VRM
- **Animation**: Skeletal bone animation engine — binary search keyframe lookup + slerp interpolation across 5 clips. Per-frame quaternion reuse (zero GC pressure)
- **Settings**: endpoint/token in localStorage, VRM model binary in IndexedDB

---

## VRM Support

VRM 0.x and 1.0. Rest pose (A-pose from T-pose) applied on load via `getNormalizedBoneNode()`. Tested with Alicia Solid (0.x) and custom VRM 1.0 models.

---

## File Structure

```
openab-companion/
├── index.html           Entry point + CSP meta tag
├── dev-server.mjs       Static file server + CORS proxy (⚠️ DEV ONLY)
├── css/
│   └── style.css        All styles
├── js/
│   ├── main.js          Init, event wiring, message handling
│   ├── vrm-scene.js     THREE.js scene, VRM loader, idle animations
│   ├── chat.js          SSE fetch + stream parser (60s timeout)
│   ├── expression.js    Emotion tag parser + VRM expression control
│   ├── animation.js     Skeletal bone animation engine
│   └── settings.js      localStorage + IndexedDB persistence
├── animations/          JSON clip files (idle, wave, nod, think, talk)
├── models/              Place .vrm files here
├── README.md
└── LICENSE
```

---

## Dependencies (CDN, no npm)

```
three@0.170
@pixiv/three-vrm@3
```

Imported as ES modules from jsDelivr. No bundler. No node_modules.

---

## Emotion Tags

| Tag | Expression |
|---|---|
| `[happy]` | Happy |
| `[sad]` | Sad |
| `[angry]` | Angry |
| `[surprised]` | Surprised |
| `[relaxed]` | Relaxed |
| `[thinking]` | Neutral |
| `[confused]` | Sad + Surprised blend |
| `[excited]` | Happy + Surprised blend |
| `[neutral]` | Neutral |

Tags are stripped from displayed text and applied with lerp transitions.

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

History is maintained by the OpenAB persistent ACP session. Only the latest user message is sent.

---

## Security

- CSP header via `<meta>` tag: `script-src 'self'` + CDN whitelist, `connect-src 'self' https:`
- Chat messages rendered with `textContent` (XSS-safe)
- `dev-server.mjs` refuses to start in production (`NODE_ENV=production`)
- Token stored in localStorage (known tradeoff — see [#4](https://github.com/smallgun01/openab-companion/issues/4))

---

## Known Limitations

- Token in localStorage (XSS surface)
- No test coverage / CI
- 40万-line animation JSON loaded eagerly
- `connect-src: https:` allows any HTTPS endpoint (tradeoff for user-configurable backends)

See [open issues](https://github.com/smallgun01/openab-companion/issues).

---

## License

**Code**: MIT

**Default model** (`models/AliciaSolid.vrm`): ニコニ立体ちゃん（Alicia Solid）by Dwango Co., Ltd.
Licensed under the [ニコニ立体ちゃんライセンス](https://3d.nicovideo.jp/alicia/rule.html).
Free to use, modify, and redistribute (non-corporate). No attribution required.
