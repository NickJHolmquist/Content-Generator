/**
 * reply.js
 *
 * Reads draft.json, finds thread posts that went live 2+ hours ago,
 * queries the Threads API to match them by timestamp, and posts the
 * CTA as a reply nested under each thread.
 *
 * Run: npm run reply
 * Triggered automatically by: .github/workflows/reply-pipeline.yml
 *
 * Requires: THREADS_ACCESS_TOKEN in .env
 * Get your token from your existing Threads app OAuth flow.
 */

import fs from "fs";
import "dotenv/config";

const DRAFT_PATH          = "./drafts/draft.json";
const THREADS_API_BASE    = "https://graph.threads.net/v1.0";
const MATCH_WINDOW_MS     = 15 * 60 * 1000; // 15 min window either side of publish_at

// ─── Threads API helpers ───────────────────────────────────────────────────

async function threadsGet(endpoint, params = {}) {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error("THREADS_ACCESS_TOKEN is not set in .env");

  const url = new URL(`${THREADS_API_BASE}${endpoint}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Threads API GET ${endpoint} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function threadsPost(endpoint, body = {}) {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error("THREADS_ACCESS_TOKEN is not set in .env");

  const url = new URL(`${THREADS_API_BASE}${endpoint}`);
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Threads API POST ${endpoint} failed (${res.status}): ${errorBody}`);
  }
  return res.json();
}

// ─── Find the live Threads post matching a scheduled publish time ──────────

async function findThreadsPostId(publishAt) {
  const targetTime = new Date(publishAt).getTime();

  // Fetch recent posts — fields include timestamp for matching
  const data = await threadsGet("/me/threads", {
    fields: "id,timestamp,text",
    limit: "25",
  });

  if (!data.data?.length) {
    console.warn("  No recent Threads posts found");
    return null;
  }

  // Find the post whose timestamp is within the match window
  const match = data.data.find((post) => {
    const postTime = new Date(post.timestamp).getTime();
    return Math.abs(postTime - targetTime) <= MATCH_WINDOW_MS;
  });

  return match?.id ?? null;
}

// ─── Post a CTA reply under a thread post ─────────────────────────────────

async function postCTAReply(postId, ctaText) {
  // Step 1: Create a reply container
  const container = await threadsPost("/me/threads", {
    media_type: "TEXT",
    text: ctaText,
    reply_to_id: postId,
  });

  if (!container.id) {
    throw new Error("Failed to create reply container — no ID returned");
  }

  // Step 2: Publish the container
  const published = await threadsPost("/me/threads_publish", {
    creation_id: container.id,
  });

  return published.id;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  if (!fs.existsSync(DRAFT_PATH)) {
    throw new Error(`No draft found at ${DRAFT_PATH}. Run npm run generate first.`);
  }

  const schedule = JSON.parse(fs.readFileSync(DRAFT_PATH, "utf-8"));
  const now = Date.now();

  // Find thread items whose CTA is due (cta_publish_at is in the past)
  // and haven't been replied to yet (threads_post_id is null)
  const pending = schedule.filter(
    (item) =>
      item.type === "thread" &&
      item.cta &&
      item.cta_publish_at &&
      new Date(item.cta_publish_at).getTime() <= now &&
      item.threads_post_id === null
  );

  if (pending.length === 0) {
    console.log("No CTA replies due right now. Nothing to do.");
    return;
  }

  console.log(`🔍 Found ${pending.length} CTA(s) to post\n`);

  let updated = false;

  for (const item of pending) {
    console.log(`  Day ${item.day}: "${item.label}"`);
    console.log(`  CTA: "${item.cta}"`);

    // Find the matching live post on Threads
    const postId = await findThreadsPostId(item.publish_at);

    if (!postId) {
      console.warn(`  ⚠️  Could not find matching Threads post — skipping (thread may not be live yet)`);
      console.log();
      continue;
    }

    console.log(`  ✓ Matched Threads post: ${postId}`);

    // Post the CTA reply
    const replyId = await postCTAReply(postId, item.cta);
    console.log(`  ✓ CTA reply posted: ${replyId}\n`);

    // Update the draft with the post ID so we don't reply twice
    item.threads_post_id = postId;
    updated = true;
  }

  // Save updated draft back to file
  if (updated) {
    fs.writeFileSync(DRAFT_PATH, JSON.stringify(schedule, null, 2), "utf-8");
    console.log("📝 draft.json updated with Threads post IDs");
  }

  console.log("\n✅ Reply run complete.");
}

run().catch((err) => {
  console.error("Reply failed:", err.message);
  process.exit(1);
});
