import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import "dotenv/config";

// ─── Config ────────────────────────────────────────────────────────────────

const NEWSLETTER_DIR = process.env.NEWSLETTER_DIR ?? "./newsletter/inbox";
const PROCESSED_DIR  = process.env.PROCESSED_DIR  ?? "./newsletter/processed";
const DAYS                = 7;
const SCHEDULE_OFFSET_DAYS = parseInt(process.env.SCHEDULE_OFFSET_DAYS ?? "1");
const CTA_DELAY_HOURS     = 2;
const CTA_TEXT            = process.env.CTA_TEXT ?? null;

// Slot times — hour in 24h local time
const SLOT_TIMES = {
  good_morning: 7,   // 7am
  thread:       9,   // 9am
  experimental: 12,  // 12pm
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Step 1: Find this week's newsletter ───────────────────────────────────

function findNewsletter() {
  if (!fs.existsSync(NEWSLETTER_DIR)) {
    fs.mkdirSync(NEWSLETTER_DIR, { recursive: true });
  }

  const files = fs
    .readdirSync(NEWSLETTER_DIR)
    .filter((f) => f.endsWith(".txt") || f.endsWith(".md"));

  if (files.length === 0) {
    console.log(`No newsletter found in ${NEWSLETTER_DIR}. Nothing to do.`);
    return null;
  }

  if (files.length > 1) {
    console.warn(`Multiple files found — using the first: ${files[0]}`);
  }

  const filePath = path.join(NEWSLETTER_DIR, files[0]);
  const raw = fs.readFileSync(filePath, "utf-8").trim();

  // Parse optional frontmatter:
  // ---
  // subject: Issue #42 — Title here
  // send_date: 2026-04-07 10:00
  // ---
  let subject = null;
  let sendDate = null;
  let content = raw;

  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (frontmatterMatch) {
    const meta = frontmatterMatch[1];
    content = frontmatterMatch[2].trim();

    const subjectMatch = meta.match(/^subject:\s*(.+)$/m);
    const dateMatch    = meta.match(/^send_date:\s*(.+)$/m);

    if (subjectMatch) subject  = subjectMatch[1].trim();
    if (dateMatch)    sendDate = dateMatch[1].trim();
  }

  console.log(`📬 Found newsletter: ${files[0]} (${content.length} chars)`);
  if (subject)  console.log(`   Subject: ${subject}`);
  if (sendDate) console.log(`   Send date: ${sendDate}`);

  return { filePath, fileName: files[0], content, subject, sendDate };
}

// ─── Step 2: Load system prompt ────────────────────────────────────────────

function loadSystemPrompt() {
  const promptPath = "./prompts/system.txt";
  if (!fs.existsSync(promptPath)) {
    throw new Error(`System prompt not found at ${promptPath}`);
  }
  return fs.readFileSync(promptPath, "utf-8").trim();
}

// ─── Step 3: Generate all content via Claude API ───────────────────────────

async function generateContent(newsletterContent, systemPrompt) {
  console.log(`🤖 Sending to Claude — generating ${DAYS} days of content...`);

  const userMessage = `
Here is this week's newsletter. Generate exactly ${DAYS} items for each slot:
- ${DAYS} good_morning posts (single tweet, evergreen, speaks to dads)
- ${DAYS} threads (derived from the newsletter, 4-6 posts each)
- ${DAYS} experimental posts (single line, attention-grabbing idea)

Rotate through different thread types and CORE content categories across the 7 threads.
Each good morning post should carry a distinct belief or reframe.

Newsletter:
---
${newsletterContent}
---

Return only the JSON object, nothing else.
`.trim();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

  let content;
  try {
    content = JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse Claude response as JSON:", rawText);
    throw new Error("Claude returned malformed JSON. Check your system prompt.");
  }

  console.log(`✅ Generated content:`);
  console.log(`   ${content.good_morning?.length  ?? 0} good morning posts`);
  console.log(`   ${content.threads?.length        ?? 0} threads`);
  console.log(`   ${content.experimental?.length   ?? 0} experimental posts`);
  if (CTA_TEXT) console.log(`   CTA: "${CTA_TEXT.slice(0, 60)}..."`);
  else          console.log(`   CTA: none (set CTA_TEXT in .env to enable)`);

  return content;
}

// ─── Step 4: Build scheduled post list ─────────────────────────────────────

function buildSchedule(content) {
  const schedule = [];

  for (let day = 0; day < DAYS; day++) {
    const date = new Date();
    date.setDate(date.getDate() + SCHEDULE_OFFSET_DAYS + day);

    // Good morning — 7am
    if (content.good_morning?.[day]) {
      const d = new Date(date);
      d.setHours(SLOT_TIMES.good_morning, 0, 0, 0);
      schedule.push({
        type: "good_morning",
        day: day + 1,
        posts: [{ text: content.good_morning[day].tweet }],
        publish_at: d.toISOString(),
        label: content.good_morning[day].tweet.slice(0, 60) + "...",
      });
    }

    // Thread — 9am, with CTA reply scheduled 2hrs later
    if (content.threads?.[day]) {
      const d = new Date(date);
      d.setHours(SLOT_TIMES.thread, 0, 0, 0);

      const ctaTime = new Date(d);
      ctaTime.setHours(ctaTime.getHours() + CTA_DELAY_HOURS);

      const thread = content.threads[day];
      schedule.push({
        type: "thread",
        day: day + 1,
        posts: thread.posts.map((text) => ({ text })),
        publish_at: d.toISOString(),
        label: thread.angle,
        cta: CTA_TEXT,
        cta_publish_at: CTA_TEXT ? ctaTime.toISOString() : null,
        threads_post_id: null,
      });
    }

    // Experimental — 12pm
    if (content.experimental?.[day]) {
      const d = new Date(date);
      d.setHours(SLOT_TIMES.experimental, 0, 0, 0);
      schedule.push({
        type: "experimental",
        day: day + 1,
        posts: [{ text: content.experimental[day].tweet }],
        publish_at: d.toISOString(),
        label: content.experimental[day].tweet.slice(0, 60) + "...",
      });
    }
  }

  return schedule;
}

// ─── Step 5: Save draft to file ────────────────────────────────────────────

function saveDraft(schedule) {
  const draftsDir = "./drafts";
  if (!fs.existsSync(draftsDir)) {
    fs.mkdirSync(draftsDir, { recursive: true });
  }

  const outputPath = path.join(draftsDir, "draft.json");
  fs.writeFileSync(outputPath, JSON.stringify(schedule, null, 2), "utf-8");
  console.log(`\n📝 Draft saved to ${outputPath}`);
  console.log(`   Review and edit the file, then run: npm run publish\n`);
}

// ─── Step 6: Archive the processed newsletter ──────────────────────────────

function archiveNewsletter(filePath, fileName) {
  if (!fs.existsSync(PROCESSED_DIR)) {
    fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().split("T")[0];
  const dest = path.join(PROCESSED_DIR, `${timestamp}-${fileName}`);
  fs.renameSync(filePath, dest);
  console.log(`📁 Newsletter archived to ${dest}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  console.log("🚀 Newsletter pipeline starting...\n");

  const newsletter = findNewsletter();
  if (!newsletter) return;

  const systemPrompt = loadSystemPrompt();
  const content      = await generateContent(newsletter.content, systemPrompt);
  const schedule     = buildSchedule(content);

  saveDraft(schedule);
  archiveNewsletter(newsletter.filePath, newsletter.fileName);

  console.log("✅ Generation complete.");
}

run().catch((err) => {
  console.error("Pipeline failed:", err.message);
  process.exit(1);
});
