/**
 * fetch-newsletter.js
 *
 * Fetches the most recently published broadcast from Kit (formerly ConvertKit)
 * and writes it as plain text to newsletter/inbox/this-week.txt
 *
 * Called as a step in GitHub Actions before the main pipeline runs.
 * Can also be run locally: node scripts/fetch-newsletter.js
 */

import fs from "fs";
import path from "path";
import { convert } from "html-to-text";
import "dotenv/config";

const KIT_API_KEY = process.env.KIT_API_KEY;
const NEWSLETTER_DIR = process.env.NEWSLETTER_DIR ?? "./newsletter/inbox";
const OUTPUT_FILE = path.join(NEWSLETTER_DIR, "this-week.txt");

if (!KIT_API_KEY) {
  throw new Error("KIT_API_KEY is not set in environment");
}

// ─── Fetch broadcast list ──────────────────────────────────────────────────

async function getLatestBroadcastId() {
  const response = await fetch(
    "https://api.kit.com/v4/broadcasts?status=sent&per_page=1",
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${KIT_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Kit API error (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const broadcasts = data.broadcasts;

  if (!broadcasts || broadcasts.length === 0) {
    throw new Error("No sent broadcasts found in Kit account");
  }

  const latest = broadcasts[0];
  console.log(`📬 Found broadcast: "${latest.subject}" (id: ${latest.id})`);
  return { id: latest.id, subject: latest.subject };
}

// ─── Fetch full broadcast content ─────────────────────────────────────────

async function getBroadcastContent(id) {
  const response = await fetch(`https://api.kit.com/v4/broadcasts/${id}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${KIT_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Kit API error (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  return data.broadcast;
}

// ─── Convert HTML to clean plain text ─────────────────────────────────────

function htmlToPlainText(html) {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },   // keep link text, drop URLs
      { selector: "img", format: "skip" },                 // skip images
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
    ],
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  if (!fs.existsSync(NEWSLETTER_DIR)) {
    fs.mkdirSync(NEWSLETTER_DIR, { recursive: true });
  }

  const { id, subject } = await getLatestBroadcastId();
  const broadcast = await getBroadcastContent(id);

  const rawHtml = broadcast.content ?? broadcast.email_body ?? "";
  if (!rawHtml) {
    throw new Error("Broadcast has no content — check Kit API response");
  }

  const plainText = htmlToPlainText(rawHtml);
  const output = `Subject: ${subject}\n\n${plainText}`;

  fs.writeFileSync(OUTPUT_FILE, output, "utf-8");
  console.log(`✅ Newsletter written to ${OUTPUT_FILE} (${plainText.length} chars)`);
}

run().catch((err) => {
  console.error("fetch-newsletter failed:", err.message);
  process.exit(1);
});
