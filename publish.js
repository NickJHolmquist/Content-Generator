import fs from "fs";
import "dotenv/config";

// ─── Config ────────────────────────────────────────────────────────────────

const DRAFT_PATH = "./drafts/draft.json";

// ─── Merge edited_posts with posts fallback ────────────────────────────────

function resolvePosts(item) {
  const edited = item.edited_posts ?? [];
  return (item.posts ?? []).map((original, i) => {
    const editedText = edited[i]?.text?.trim();
    return { text: editedText || original.text };
  });
}

function resolveLinkedInPosts(item) {
  const posts = resolvePosts(item);
  if (posts.length <= 1) return posts;
  return [{ text: posts.map((p) => p.text).join("\n\n") }];
}

// ─── Retry helper ──────────────────────────────────────────────────────────

async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok || response.status < 500) return response;
    if (attempt < retries) {
      const wait = attempt * 3000;
      console.log(`  ⚠ Server error (${response.status}), retrying in ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
    } else {
      return response;
    }
  }
}

// ─── Push to Typefully ─────────────────────────────────────────────────────

async function pushToTypefully(schedule) {
  const socialSetId = process.env.TYPEFULLY_SOCIAL_SET_ID;
  if (!socialSetId) {
    throw new Error(
      "TYPEFULLY_SOCIAL_SET_ID is not set. Find it in Typefully → Settings → API with Development mode enabled."
    );
  }

  console.log(`📤 Pushing ${schedule.length} drafts to Typefully...\n`);

  for (const item of schedule) {
    const response = await fetchWithRetry(
      `https://api.typefully.com/v2/social-sets/${socialSetId}/drafts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TYPEFULLY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platforms: {
            threads:  { enabled: true, posts: resolvePosts(item) },
            linkedin: { enabled: true, posts: resolveLinkedInPosts(item) },
            bluesky:  { enabled: true, posts: resolvePosts(item) },
          },
          publish_at: item.publish_at,
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Typefully API error (${response.status}): ${errorBody}`);
    }

    await response.json();
    const time = item.publish_at.split("T")[1].slice(0, 5);
    console.log(`  ✓ Day ${item.day} [${time}] ${item.type} — ${item.label}`);
  }

  console.log("\n🎉 All drafts pushed. Head to Typefully to review before they go live.");
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  if (!fs.existsSync(DRAFT_PATH)) {
    throw new Error(`No draft found at ${DRAFT_PATH}. Run npm run generate first.`);
  }

  let schedule = JSON.parse(fs.readFileSync(DRAFT_PATH, "utf-8"));

  const fromDay = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  if (fromDay) {
    schedule = schedule.filter((item) => item.day >= fromDay);
    console.log(`⏩ Resuming from day ${fromDay} (${schedule.length} posts remaining)\n`);
  } else {
    console.log(`📂 Loaded draft with ${schedule.length} posts\n`);
  }

  await pushToTypefully(schedule);
}

run().catch((err) => {
  console.error("Publish failed:", err.message);
  process.exit(1);
});
