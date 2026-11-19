# tickr

A lightweight task management tool for efficient workflow organization.

---

### Purpose
A simple, intuitive platform to create, organize, and complete tasks across multiple projects.

---

### Key Features
- 📝 Task creation and editing
- 📋 Project categorization
- 📅 Timeline tracking
- 📱 Mobile-friendly interface

---

### Installation
```bash
npm install -g tickr
tickr start
```

---

### AI duration lookup (no setup needed)
When a typed request has no recognizable duration (e.g. `brisket`), tickr asks its built-in AI service for a sensible duration and starts the timer from the answer — no key, account, or webhook is required.

- `/agent` — show the current mode
- `/agent off` — turn lookups off (tickr then shows the local "no duration" error)
- `/agent auto` — switch back to the built-in AI (the default)
- `/agent https://your-webhook.example.com/timer` — override with your own agent endpoint (saved in this browser)

The built-in service is the keyless, CORS-enabled Pollinations text API (`https://text.pollinations.ai/openai`): tickr sends a short system prompt plus the exact typed request. The reply is expected as one JSON object, e.g. `{"label":"Brisket","seconds":28800,"tip":"Rest before slicing."}`. Fenced JSON, plain text containing a duration, and OpenAI-style `choices[0].message.content` replies are accepted too. The free tier is rate-limited (roughly one request per minute per IP) — tickr explains the wait instead of failing silently, and you can always type the duration directly (`brisket 12 minutes`).

A custom webhook receives `{"app":"tickr","request":"brisket"}` and may answer with `{"label":"Brisket","duration":"12 minutes"}`, `{"seconds":720}`, `{"timers":[…]}`, plain text, or MCP-style `content` blocks (n8n / Make / Zapier or any HTTP agent; MCP servers need an HTTP bridge). Custom endpoints time out after 15 s, built-in lookups after 20 s.

Note: when no local duration is found, the typed request is sent to a third-party AI service. Use `/agent off` if you don't want that.

---

### License
MIT License  

---

### Contributing
Please submit pull requests with descriptive commit messages.

---

**Repository**: [GitHub](https://github.com/your-username/tickr)