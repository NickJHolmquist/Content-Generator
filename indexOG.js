import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import "dotenv/config";

// ─── Config ────────────────────────────────────────────────────────────────

const NEWSLETTER_DIR = process.env.NEWSLETTER_DIR ?? "./newsletter/inbox";
const PROCESSED_DIR = process.env.PROCESSED_DIR ?? "./newsletter/processed";
const THREADS_PER_NEWSLETTER = parseInt(process.env.THREADS_PER_NEWSLETTER ?? "5");
const SCHEDULE_OFFSET_DAYS = parseInt(process.env.SCHEDULE_OFFSET_DAYS ?? "1");
const DRY_RUN = process.env.DRY_RUN === "true";

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
  console.log(`📬 Found newsletter: ${files[0]} (${raw.length} chars)`);
 
  // Parse optional frontmatter block:
  // ---
  // subject: Issue #42 — My newsletter title
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
    const dateMatch = meta.match(/^send_date:\s*(.+)$/m);
 
    if (subjectMatch) subject = subjectMatch[1].trim();
    if (dateMatch) sendDate = dateMatch[1].trim();
  }

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

// ─── Step 3: Generate threads via Claude API ───────────────────────────────

async function generateThreads(newsletterContent, systemPrompt) {
  console.log(`🤖 Sending to Claude — generating ${THREADS_PER_NEWSLETTER} threads...`);

  const userMessage = `
Here is this week's newsletter. Please generate exactly ${THREADS_PER_NEWSLETTER} thread drafts from it.

---
${newsletterContent}
---

Remember: return only the JSON array, nothing else.
`.trim();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Strip any accidental markdown fences before parsing
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

  let threads;
  try {
    threads = JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse Claude response as JSON:", rawText);
    throw new Error("Claude returned malformed JSON. Check your system prompt.");
  }

  console.log(`✅ Generated ${threads.length} thread drafts`);
  return threads;
}

// ─── Step 4: Format threads for Typefully ──────────────────────────────────
//
// Typefully expects thread tweets separated by "\n\n---\n\n"
// Docs: https://typefully.com/developer

function formatForTypefully(thread) {
  return thread.tweets.map((text) => ({ text }));
}

function scheduleDateForPost(indexFromToday) {
  const date = new Date();
  date.setDate(date.getDate() + SCHEDULE_OFFSET_DAYS + indexFromToday);
  date.setHours(9, 0, 0, 0); // 9am — adjust to your preferred send time
  return date.toISOString();
}

async function pushToTypefully(threads) {
  if (DRY_RUN) {
    console.log("\n🧪 DRY RUN — would have posted the following to Typefully:\n");
    threads.forEach((thread, i) => {
      console.log(`--- Thread ${i + 1}: ${thread.angle} ---`);
      thread.tweets.forEach((tweet, t) => console.log(`  [${t + 1}] ${tweet}`));
      console.log();
    });
    return;
  }

  const socialSetId = process.env.TYPEFULLY_SOCIAL_SET_ID;
  if (!socialSetId) {
    throw new Error("TYPEFULLY_SOCIAL_SET_ID is not set. Find it in Typefully → Settings → API with Development mode enabled.");
  }

  console.log(`📤 Pushing ${threads.length} drafts to Typefully...`);

  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i];
    const posts = formatForTypefully(thread);
    const scheduledDate = scheduleDateForPost(i);

    const response = await fetch(
      `https://api.typefully.com/v2/social-sets/${socialSetId}/drafts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TYPEFULLY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platforms: {
            x: {
              enabled: true,
              posts,
            },
          },
          publish_at: scheduledDate,
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Typefully API error (${response.status}): ${errorBody}`);
    }

    await response.json();
    console.log(`  ✓ Draft ${i + 1}/${threads.length} posted — angle: "${thread.angle}" → scheduled: ${scheduledDate}`);
  }

  console.log("🎉 All drafts pushed. Head to Typefully to review before they go live.");
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
  const threads = await generateThreads(newsletter.content, systemPrompt);

  await pushToTypefully(threads);
  archiveNewsletter(newsletter.filePath, newsletter.fileName);

  console.log("\n✅ Pipeline complete.");
}

run().catch((err) => {
  console.error("Pipeline failed:", err.message);
  process.exit(1);
});
