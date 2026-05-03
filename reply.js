import "dotenv/config";

const THREADS_API_BASE = "https://graph.threads.net/v1.0";

// Thread goes out at 9:13 AM PDT = 16:13 UTC. Update if publish schedule changes.
const THREAD_SLOT_UTC  = { hour: 16, minute: 13 };
const MATCH_WINDOW_MS  = 30 * 60 * 1000; // ±30 min to find today's thread post
const CHAIN_WINDOW_MS  = 10 * 60 * 1000; // replies within 10 min are part of the thread chain

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Threads API helpers ───────────────────────────────────────────────────

async function threadsGet(endpoint, params = {}) {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error("THREADS_ACCESS_TOKEN is not set");

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
  if (!token) throw new Error("THREADS_ACCESS_TOKEN is not set");

  const url = new URL(`${THREADS_API_BASE}${endpoint}`);
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Threads API POST ${endpoint} failed (${res.status}): ${body}`);
  }
  return res.json();
}

// ─── Find today's thread root post ────────────────────────────────────────

async function findTodaysThreadPost() {
  const now = new Date();
  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    THREAD_SLOT_UTC.hour,
    THREAD_SLOT_UTC.minute
  ));

  const data = await threadsGet("/me/threads", {
    fields: "id,timestamp,text",
    limit: "25",
  });

  if (!data.data?.length) {
    console.warn("No recent Threads posts found");
    return null;
  }

  return data.data.find((post) => {
    const diff = Math.abs(new Date(post.timestamp).getTime() - target.getTime());
    return diff <= MATCH_WINDOW_MS;
  }) ?? null;
}

// ─── Walk the reply chain to the last post in the thread ──────────────────
// Typefully posts thread replies seconds apart — CHAIN_WINDOW_MS filters out
// any replies added later (like this CTA itself on a re-run).

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
        return diff > 0 && diff <= CHAIN_WINDOW_MS;
      })
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0];

    if (!next) break;
    current = next;
  }

  return current;
}

// ─── Post the CTA reply ───────────────────────────────────────────────────

async function postCTAReply(postId, ctaText) {
  const container = await threadsPost("/me/threads", {
    media_type: "TEXT",
    text: ctaText,
    reply_to_id: postId,
  });

  if (!container.id) throw new Error("No container ID returned");

  // Poll until the container is ready to publish
  let status = "";
  for (let i = 0; i < 10; i++) {
    const { status: s } = await threadsGet(`/${container.id}`, { fields: "status" });
    status = s;
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`Container ${container.id} failed with status: ${status}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (status !== "FINISHED") throw new Error("Container never became ready");

  const published = await threadsPost("/me/threads_publish", { creation_id: container.id });
  return published.id;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function run() {
  const ctaText = process.env.CTA_TEXT;
  if (!ctaText) {
    console.error("CTA_TEXT is not set");
    process.exit(1);
  }

  if (DRY_RUN) console.log("--- DRY RUN — no replies will be posted ---\n");

  const rootPost = await findTodaysThreadPost();
  if (!rootPost) {
    console.log("No thread post found for today's slot. Nothing to do.");
    return;
  }

  console.log(`Root post: ${rootPost.id}`);

  const lastPost = await findLastPostInThread(rootPost);
  console.log(`Last post: ${lastPost.id}`);
  console.log(`Text:\n  ${lastPost.text.split("\n").join("\n  ")}\n`);
  console.log(`CTA: "${ctaText}"\n`);

  if (DRY_RUN) {
    console.log("[dry run] Skipping reply POST");
    return;
  }

  const replyId = await postCTAReply(lastPost.id, ctaText);
  console.log(`CTA reply posted: ${replyId}`);
}

run().catch((err) => {
  console.error("Reply failed:", err.message);
  process.exit(1);
});
