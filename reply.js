import fs from "fs";
import "dotenv/config";

const CTA_DELAY_HOURS      = 2;
const THREADS_API_BASE     = "https://graph.threads.net/v1.0";
const MATCH_WINDOW_MS      = 15 * 60 * 1000;
const THREAD_CHAIN_WINDOW_MS = 10 * 60 * 1000; // thread posts appear seconds apart; 10 min is generous

const DRY_RUN    = process.argv.includes("--dry-run");
const draftArg   = process.argv.indexOf("--draft");
const DRAFT_PATH = draftArg !== -1 ? process.argv[draftArg + 1] : "./drafts/draft.json";

// ─── Threads API helpers ───────────────────────────────────────────────────

async function threadsGet(endpoint, params = {}) {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error("THREADS_ACCESS_TOKEN is not set in .env");

  const url = new URL(`${THREADS_API_BASE}${endpoint}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

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

// ─── Find the root post matching a scheduled publish time ─────────────────

async function findRootPost(publishAt) {
  const targetTime = new Date(publishAt).getTime();

  const data = await threadsGet("/me/threads", {
    fields: "id,timestamp,text",
    limit: "25",
  });

  if (!data.data?.length) {
    console.warn("  No recent Threads posts found");
    return null;
  }

  return data.data.find((post) => {
    const postTime = new Date(post.timestamp).getTime();
    return Math.abs(postTime - targetTime) <= MATCH_WINDOW_MS;
  }) ?? null;
}

// ─── Walk the reply chain to find the last post in the thread ─────────────
// Typefully publishes multi-post threads as a chain: each post replies to
// the previous one. We follow replies that fall within the chain window
// (thread posts appear seconds apart) until no more are found.

async function findLastPostInThread(rootPost) {
  let current = rootPost;

  while (true) {
    const data = await threadsGet(`/${current.id}/replies`, {
      fields: "id,timestamp,text",
      limit: "10",
    });

    if (!data.data?.length) break;

    const currentTime = new Date(current.timestamp).getTime();
    const next = data.data
      .filter((p) => {
        const diff = new Date(p.timestamp).getTime() - currentTime;
        return diff > 0 && diff <= THREAD_CHAIN_WINDOW_MS;
      })
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0];

    if (!next) break;
    current = next;
  }

  return current;
}

// ─── Post a CTA reply ─────────────────────────────────────────────────────

async function postCTAReply(postId, ctaText) {
  const container = await threadsPost("/me/threads", {
    media_type: "TEXT",
    text: ctaText,
    reply_to_id: postId,
  });

  if (!container.id) throw new Error("Failed to create reply container — no ID returned");

  // Wait for the container to be ready before publishing
  let status = "";
  for (let i = 0; i < 10; i++) {
    const statusData = await threadsGet(`/${container.id}`, { fields: "status" });
    status = statusData.status;
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`Container ${container.id} failed with status: ${status}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (status !== "FINISHED") throw new Error("Container never became ready");

  const published = await threadsPost("/me/threads_publish", {
    creation_id: container.id,
  });

  return published.id;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  const ctaText = process.env.CTA_TEXT;
  if (!ctaText) {
    console.error("CTA_TEXT is not set — nothing to post.");
    process.exit(1);
  }

  if (!fs.existsSync(DRAFT_PATH)) {
    throw new Error(`No draft found at ${DRAFT_PATH}`);
  }

  if (DRY_RUN) console.log("--- DRY RUN — no replies will be posted ---\n");

  const schedule = JSON.parse(fs.readFileSync(DRAFT_PATH, "utf-8"));
  const now = Date.now();

  const pending = schedule.filter((item) => {
    if (item.type !== "thread") return false;
    if (item.threads_post_id !== null) return false;
    const ctaPublishAt = new Date(item.publish_at).getTime() + CTA_DELAY_HOURS * 60 * 60 * 1000;
    return ctaPublishAt <= now;
  });

  if (pending.length === 0) {
    console.log("No CTA replies due right now. Nothing to do.");
    return;
  }

  console.log(`Found ${pending.length} CTA(s) to post\n`);

  let updated = false;

  for (const item of pending) {
    console.log(`Day ${item.day}: "${item.label}"`);

    const rootPost = await findRootPost(item.publish_at);

    if (!rootPost) {
      console.warn(`  Could not find matching Threads post — skipping\n`);
      continue;
    }

    console.log(`  Root post matched: ${rootPost.id}`);

    const lastPost = await findLastPostInThread(rootPost);
    const isChained = lastPost.id !== rootPost.id;

    console.log(`  Last post in thread: ${lastPost.id}${isChained ? "" : " (single post — same as root)"}`);
    console.log(`  Last post text:\n`);
    console.log(`    ${lastPost.text.split("\n").join("\n    ")}\n`);
    console.log(`  CTA to post: "${ctaText}"\n`);

    if (DRY_RUN) {
      console.log(`  [dry run] Skipping reply POST\n`);
      continue;
    }

    const replyId = await postCTAReply(lastPost.id, ctaText);
    console.log(`  CTA reply posted: ${replyId}\n`);

    item.threads_post_id = rootPost.id;
    updated = true;
  }

  if (updated) {
    fs.writeFileSync(DRAFT_PATH, JSON.stringify(schedule, null, 2), "utf-8");
    console.log("draft.json updated with Threads post IDs");
  }

  console.log("Reply run complete.");
}

run().catch((err) => {
  console.error("Reply failed:", err.message);
  process.exit(1);
});
