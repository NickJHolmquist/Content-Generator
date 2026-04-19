import fs from "fs";
import "dotenv/config";

// ─── Config ────────────────────────────────────────────────────────────────

const DRAFT_PATH = "./drafts/draft.json";

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
            x:        { enabled: true, posts: item.posts },
            threads:  { enabled: true, posts: item.posts },
            linkedin: { enabled: true, posts: item.posts },
            bluesky:  { enabled: true, posts: item.posts },
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

  const schedule = JSON.parse(fs.readFileSync(DRAFT_PATH, "utf-8"));
  console.log(`📂 Loaded draft with ${schedule.length} posts\n`);

  await pushToTypefully(schedule);
}

run().catch((err) => {
  console.error("Publish failed:", err.message);
  process.exit(1);
});
