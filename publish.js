import fs from "fs";
import path from "path";
import "dotenv/config";

// ─── Config ────────────────────────────────────────────────────────────────

function findDraftPath() {
  const draftsDir = "./drafts";
  const files = fs.readdirSync(draftsDir).filter((f) => f.endsWith("_drafts.json"));
  if (files.length === 0) throw new Error("No draft file found in ./drafts/. Run npm run generate first.");
  if (files.length > 1) console.warn(`Multiple drafts found — using: ${files[0]}`);
  return path.join(draftsDir, files[0]);
}

function archiveDraft(draftPath) {
  const pastDir = "./drafts/past";
  if (!fs.existsSync(pastDir)) fs.mkdirSync(pastDir, { recursive: true });
  const dest = path.join(pastDir, path.basename(draftPath).replace("_drafts.json", "_published.json"));
  fs.renameSync(draftPath, dest);
  console.log(`📁 Draft archived to ${dest}`);
}

const SLOT_TIMES = {
  good_morning: { hour: 7,  minute: 7  },
  thread:       { hour: 9,  minute: 13 },
  experimental: { hour: 12, minute: 4  },
};

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

const REDATE_START_DELAY_MINUTES = 15;
const REDATE_TODAY_INTERVAL_MINUTES = 120;

const SLOT_ORDER = { good_morning: 0, thread: 1, experimental: 2 };

function redateSchedule(schedule) {
  const now = new Date();
  const days = [...new Set(schedule.map((i) => i.day))].sort((a, b) => a - b);
  const redated = [];

  days.forEach((day, index) => {
    const dayItems = schedule
      .filter((i) => i.day === day)
      .sort((a, b) => (SLOT_ORDER[a.type] ?? 99) - (SLOT_ORDER[b.type] ?? 99));

    if (index === 0) {
      // Today: start now + 15 min, space posts 30 min apart
      dayItems.forEach((item, i) => {
        const d = new Date(now.getTime() + (REDATE_START_DELAY_MINUTES + i * REDATE_TODAY_INTERVAL_MINUTES) * 60 * 1000);
        console.log(`  📅 Today Day ${item.day} [${item.type}] → ${d.toLocaleTimeString()}`);
        redated.push({ ...item, publish_at: d.toISOString() });
      });
    } else {
      // Future days: use normal slot times
      const date = new Date();
      date.setDate(now.getDate() + index);

      dayItems.forEach((item) => {
        const slot = SLOT_TIMES[item.type];
        if (!slot) return;
        const d = new Date(date);
        d.setHours(slot.hour, slot.minute, 0, 0);
        redated.push({ ...item, publish_at: d.toISOString() });
      });
    }
  });

  return redated;
}

async function run() {
  const draftPath = findDraftPath();
  let schedule = JSON.parse(fs.readFileSync(draftPath, "utf-8"));

  const args = process.argv.slice(2);
  const redate = args.includes("--redate");
  const fromDay = args.find((a) => /^\d+$/.test(a)) ? parseInt(args.find((a) => /^\d+$/.test(a)), 10) : null;

  if (redate) {
    console.log(`📅 Redating schedule from today...\n`);
    schedule = redateSchedule(schedule);
    console.log(`\n📂 ${schedule.length} posts scheduled after redating\n`);
  } else if (fromDay) {
    schedule = schedule.filter((item) => item.day >= fromDay);
    console.log(`⏩ Resuming from day ${fromDay} (${schedule.length} posts remaining)\n`);
  } else {
    console.log(`📂 Loaded draft with ${schedule.length} posts\n`);
  }

  await pushToTypefully(schedule);
  archiveDraft(draftPath);
}

run().catch((err) => {
  console.error("Publish failed:", err.message);
  process.exit(1);
});
