# Newsletter → Threads Pipeline

Publish your Kit newsletter → Claude generates thread drafts → Typefully queues them for review.

**Zero weekly manual steps.** Publishing your newsletter in Kit is the only trigger.

---

## How it works

```
You publish newsletter in Kit
        ↓
Kit fires a webhook
        ↓
Cloudflare Worker receives it (free, ~25 lines)
        ↓
Worker calls GitHub API → triggers GitHub Actions
        ↓
GitHub Actions: fetches newsletter from Kit API
        ↓
Claude generates 5 thread drafts
        ↓
Typefully receives drafts, scheduled across the week
        ↓
You review & approve when you have a few minutes
```

---

## Setup

### 1. Install dependencies

```bash
git clone <your-repo>
cd newsletter-pipeline
npm install
cp .env.example .env
```

### 2. API keys you need

| Key | Where to get it |
|-----|----------------|
| `ANTHROPIC_API_KEY` | platform.anthropic.com → API Keys |
| `TYPEFULLY_API_KEY` | typefully.com → Settings → API |
| `KIT_API_KEY` | kit.com → Settings → Developer → API Keys |
| `GITHUB_TOKEN` | github.com → Settings → Developer settings → Personal access tokens (needs `repo` scope) |

### 3. Customize your voice

Edit `prompts/system.txt` — this is the brain of the whole thing. Add:
- Your tone and writing style
- A few example threads you've written that you like
- Topics or angles you want Claude to focus on

No code changes needed, ever, to adjust how it writes.

### 4. Test it locally first

```bash
# Fetches your latest Kit broadcast and writes it to newsletter/inbox/
node scripts/fetch-newsletter.js

# Generates threads but doesn't post to Typefully
npm run dry-run

# The real thing
npm start
```

### 5. Deploy the Cloudflare Worker (webhook bridge)

This is the piece that connects Kit → GitHub Actions. Free, takes about 5 minutes.

1. Create a free account at cloudflare.com
2. Go to Workers & Pages → Create Worker
3. Paste the contents of `cloudflare-worker/index.js`
4. Go to Settings → Variables and add:
   - `GITHUB_TOKEN` — your GitHub PAT
   - `GITHUB_OWNER` — your GitHub username
   - `GITHUB_REPO` — `newsletter-pipeline` (or whatever you named it)
   - `WEBHOOK_SECRET` — any random string (e.g. `openssl rand -hex 20`)
5. Deploy and copy your Worker URL

### 6. Register the webhook in Kit

1. Kit → Settings → Developer → Webhooks → Add webhook
2. URL: `https://your-worker.workers.dev?secret=YOUR_WEBHOOK_SECRET`
3. Event: `broadcast.sent`
4. Save

### 7. Add secrets to GitHub Actions

Repo → Settings → Secrets and variables → Actions → New repository secret

Add: `ANTHROPIC_API_KEY`, `TYPEFULLY_API_KEY`, `KIT_API_KEY`

---

## Your weekly workflow

1. Write and publish your newsletter in Kit as normal
2. That's it — Typefully will have 5 drafts queued within a minute or two
3. Review and approve in Typefully whenever you have a few minutes

---

## Folder structure

```
newsletter-pipeline/
├── index.js                          # Main pipeline — Claude → Typefully
├── scripts/
│   └── fetch-newsletter.js           # Fetches latest broadcast from Kit API
├── cloudflare-worker/
│   └── index.js                      # Webhook bridge: Kit → GitHub Actions
├── prompts/
│   └── system.txt                    # Claude's instructions — edit freely
├── newsletter/
│   ├── inbox/                        # Written to by fetch-newsletter.js
│   └── processed/                    # Archived after each run
├── .github/
│   └── workflows/
│       └── weekly-pipeline.yml       # GitHub Actions (webhook + Monday cron fallback)
├── .env.example
└── package.json
```

---

## Future additions

- **Performance feedback loop** — pull Threads metrics weekly, feed back into the prompt so Claude adjusts based on what's resonating
- **Multi-format** — generate LinkedIn posts or video scripts from the same newsletter in the same run
