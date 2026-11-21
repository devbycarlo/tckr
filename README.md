# ⏱️ tickr

> **A full-screen countdown timer that speaks human.**  
> Type `eggs`, `pasta 10 minutes`, or `chicken 45m, asparagus 12m, finish at 7pm` — tickr figures out the durations and runs the timers. No build step, no fuss. ✨

![Static Site](https://img.shields.io/badge/site-static-111?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-installable-5a67d8?style=flat-square)
![Tests](https://img.shields.io/badge/tests-node%20--test-38a169?style=flat-square)
![License](https://img.shields.io/badge/license-GPL--3.0-e53e3e?style=flat-square)

---

## 🎯 What it does

- **Big, clickable countdown.** Large `MM:SS` display — click to edit, `Space` to start/pause, `Enter` to commit.
- **Natural-language durations.** A tiny parser turns plain words into one or more staggered timers (longest first, in chronological order). Each timer shows its name, duration, and a helpful tip.
- **Chat input.** A bottom form for plain-text requests that get parsed and staged into the queue.
- **Scheduled queue.** At-a-glance list of upcoming timers.
- **AI duration lookup.** No local match? tickr asks an AI agent for a sensible duration and starts the timer from the answer — **no key, account, or webhook needed** for the built-in providers.
- **Installable PWA.** Service worker + manifest + icons. Shell caches offline; the whole app is a single `index.html`.

---

## 🤖 AI agent system

| Command | Effect |
| --- | --- |
| `/agent` | Show the current mode |
| `/agent off` | Turn lookups off (tickr shows the local "no duration" error) |
| `/agent auto` | Switch back to the built-in AI (the default) |
| `/agent https://…` | Point lookups at your own agent endpoint (saved in this browser) |

**Built-in AI** (keyless, no webhook) uses two independent, CORS-enabled providers with automatic failover — `text.pollinations.ai` and `api.apillmfree.com` — each with a ~20 s timeout. It expects one JSON object, e.g. `{"label":"Brisket","seconds":28800,"tip":"Rest before slicing."}`. Fenced JSON, plain text containing a duration, and OpenAI-style `choices[0].message.content` replies are all accepted.

**Custom agent** — receive `{"app":"tickr","request":"…"}` and answer with `{"label":"…","seconds":720}`, `{"timers":[…]}`, plain text, or MCP-style `{content:[{type:"text",text:"…"}]}` blocks. 15 s timeout.

> 💡 Use `/agent off` if you don't want the app to reach out to a third-party AI.

---

## 🚀 Install & run (locally)

```bash
npm install      # only needed to run the test suite
npm test
# open index.html in a browser (or serve the folder, e.g. `npx serve .`)
```

No build step, no dependencies beyond Node for tests. `npm test` runs the suite with Node's built-in test runner (`node --test`).

---

## ☁️ Deploy

Firebase Hosting. `firebase.json` serves the folder as `tickr-78b4b` (see `.firebaserc`), rewrites every route to `index.html`, and sets short max-age headers on the service worker so updates take effect while keeping other assets stale-for-a-moment.

```bash
firebase login
firebase deploy
```

The service worker is cached `no-cache`/controlled per-file so a new deploy prompts the user to refresh rather than serving a stale shell.

---

## 📁 Files

| Path | Purpose |
| --- | --- |
| `index.html` | The whole app (markup + styles + script) |
| `sw.js` | Service worker (cache-first shell, navigation fallback) |
| `site.webmanifest` | Installability manifest |
| `firebase.json` | Hosting configuration + cache headers |
| `.firebaserc` | Firebase project (`tickr-78b4b`) |
| `tests/` | `node --test` suite |

---

## 📜 License

GPL-3.0 — see [`LICENSE`](LICENSE).

---

**Repository**: [devbycarlo/tckr](https://github.com/devbycarlo/tckr) — kept in sync with the deployed site; update it on every successful commit & deploy.
