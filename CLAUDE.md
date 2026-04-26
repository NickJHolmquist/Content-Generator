# Content Engine — Project Context for Claude

## North Star

The core loop is: **game development → newsletter about the game → social content from the newsletter.** That loop is sacred. Everything built here exists to run the social/growth side with minimum weekly input from the creator so that creative time stays protected.

The game (working title: The Family Needs Management Game) is the product — fantasy-themed life management with energy states, emotional difficulty ratings, external scaffolding mechanics, quest types. The newsletter documents its construction. The social engine amplifies it.

**Current stage:** Pipeline running (first week of content posted). Kit landing pages exist but speak to old content — need replacing with something custom. Social is live but growth engine is not yet automated.

## Priority Filter

**Primary:** Does this reduce weekly creative time investment while keeping the content engine running?  
**Secondary:** Does this support game development (which feeds the newsletter which feeds social)?  
**Growth:** Does this move someone from "discovered you" to "on your list"?

The first filter protects the core loop. Don't sacrifice game/newsletter quality for growth tactics.

## Roadmap

| # | Item | Status | Done When |
|---|---|---|---|
| 1 | Research agents for game mechanics | `not started` | Can query for science-backed references and mechanic inspiration on demand |
| 2 | Draft editor HTML file | `not started` | Open file → load draft.json → edit → save → publish sends edited text |
| 3 | Deploy CTA reply system | `not started` | CTA reply appears under live Threads post, `threads_post_id` written to draft.json |
| 4 | Custom landing page (Kit API) | `not started` | Starter projects exist — finish and connect to Kit API for email capture |
| 5 | Newsletter fetch script | `not started` | `node scripts/fetch-newsletter.js` → file in inbox → generate runs cleanly |

## Kill List (Don't Build These)

| Item | Why |
|---|---|
| Newsletter scheduling through this app | Kit already handles it |
| Quest dashboard | The board game is this — don't build a software version of the product |
| Kit landing page builder | Already have Kit pages; want custom page connecting to Kit API instead |

## Weekly Check-In Protocol

Start any planning session with:
> "Here's what shipped since last time: [X]. I'm thinking of building next: [Y]. Does that make sense given where we are?"

Claude will evaluate against the priority filter and current roadmap status.

## System State

| Thing | State |
|---|---|
| Content generation pipeline | Live — `npm run generate` |
| Typefully publishing | Live — `npm run publish [day]` |
| CTA reply system | Coded in `updated/reply.js`, NOT deployed |
| CTA reply workflow | Written in `updated/reply-pipeline.yml`, NOT in `.github/workflows/` |
| GitHub Actions main workflow | Live in `.github/workflows/weekly-pipeline.yml` |
| `THREADS_ACCESS_TOKEN` | NOT set in GitHub Secrets |
| `CTA_TEXT` | NOT set — needs landing page URL first |
| Landing page URL | Does not exist yet |
| Draft editor UI | Does not exist yet |

## Content Pipeline (Quick Reference)

```
newsletter/inbox/{file}.txt
        ↓ npm run generate
drafts/draft.json  (edit edited_posts here, empty string = use original)
        ↓ npm run publish [optional: start-day]
Typefully → Threads, LinkedIn, Bluesky
        ↓ (after CTA deploy) automatic cron reply on Threads
```

## Git Workflow — Required for All Changes

**Never push to main directly.** All changes must go through a branch and PR.

1. Identify the relevant GitHub issue before starting any work
2. If no issue exists and the user assigned the task directly, create the issue first — then branch from it
3. If no issue exists and the task was not directly assigned, stop and ask before proceeding
4. Check out a new branch: `issue/{number}-short-description` (e.g. `issue/2-deploy-cta-reply`)
5. Make changes on that branch only
6. Open a PR — do not merge it yourself
7. The user reviews and merges

## Voice & Game Context

The newsletter speaks to dads with ADHD-adjacent struggles trying to stay themselves while building something. The game's vocabulary is the differentiator: quests (tasks), energy states, guild skills, status effects, the Quest Collector (external inbox for life-assigned tasks), emotional difficulty ratings. Use this language in landing page copy.
