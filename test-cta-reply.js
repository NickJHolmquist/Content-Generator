import "dotenv/config";

const THREADS_API_BASE = "https://graph.threads.net/v1.0";
const token = process.env.THREADS_ACCESS_TOKEN;
const ctaText = process.env.CTA_TEXT;

if (!token) { console.error("THREADS_ACCESS_TOKEN not set"); process.exit(1); }
if (!ctaText) { console.error("CTA_TEXT not set"); process.exit(1); }

// Fetch recent posts — filter to root posts (not replies), take the most recent thread opener
const listUrl = new URL(`${THREADS_API_BASE}/me/threads`);
listUrl.searchParams.set("fields", "id,timestamp,text,is_reply");
listUrl.searchParams.set("limit", "10");
listUrl.searchParams.set("access_token", token);

const listRes = await fetch(listUrl.toString());
const { data } = await listRes.json();

if (!data?.length) { console.error("No posts found"); process.exit(1); }

// Root posts only (not replies to other posts), skip the first one since
// single-post content (good morning, experimental) can appear after threads
const rootPosts = data.filter((p) => !p.is_reply);
// The most recent root post with more than one sentence is likely a thread opener,
// but we can't tell from the API alone — take the second root post since the
// first is typically a single-post type posted after the thread
const latest = rootPosts[1] ?? rootPosts[0];
console.log("Most recent post:");
console.log(`  ID:        ${latest.id}`);
console.log(`  Posted at: ${latest.timestamp}`);
console.log(`  Text:\n`);
console.log(`    ${latest.text.split("\n").join("\n    ")}\n`);
console.log(`Posting CTA reply:\n  "${ctaText}"\n`);

// Step 1: create reply container
const createUrl = new URL(`${THREADS_API_BASE}/me/threads`);
createUrl.searchParams.set("access_token", token);

const createRes = await fetch(createUrl.toString(), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ media_type: "TEXT", text: ctaText, reply_to_id: latest.id }),
});
const container = await createRes.json();
if (!container.id) { console.error("Failed to create container:", container); process.exit(1); }

// Step 2: wait for container to be ready
let status = "";
for (let i = 0; i < 10; i++) {
  const statusUrl = new URL(`${THREADS_API_BASE}/${container.id}`);
  statusUrl.searchParams.set("fields", "status");
  statusUrl.searchParams.set("access_token", token);
  const statusRes = await fetch(statusUrl.toString());
  const statusData = await statusRes.json();
  status = statusData.status;
  console.log(`  Container status: ${status}`);
  if (status === "FINISHED") break;
  if (status === "ERROR" || status === "EXPIRED") {
    console.error("Container failed:", statusData);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
if (status !== "FINISHED") { console.error("Container never became ready"); process.exit(1); }

// Step 3: publish
const publishUrl = new URL(`${THREADS_API_BASE}/me/threads_publish`);
publishUrl.searchParams.set("access_token", token);

const publishRes = await fetch(publishUrl.toString(), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ creation_id: container.id }),
});
const published = await publishRes.json();

if (!published.id) { console.error("Failed to publish:", published); process.exit(1); }
console.log(`CTA reply posted successfully — reply ID: ${published.id}`);
