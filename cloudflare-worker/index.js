/**
 * Cloudflare Worker — Kit → GitHub Actions webhook bridge
 *
 * Deploy this as a free Cloudflare Worker.
 * It receives Kit's broadcast.sent webhook and fires a
 * GitHub Actions repository_dispatch event to kick off the pipeline.
 *
 * Setup:
 * 1. Create a free Cloudflare account at cloudflare.com
 * 2. Go to Workers & Pages → Create Worker
 * 3. Paste this code in
 * 4. Add these environment variables in the Worker settings:
 *    - GITHUB_TOKEN      → a GitHub Personal Access Token with repo scope
 *    - GITHUB_OWNER      → your GitHub username
 *    - GITHUB_REPO       → your pipeline repo name
 *    - WEBHOOK_SECRET    → any random string (you'll set the same value in Kit)
 * 5. Copy your Worker URL (e.g. https://kit-bridge.yourname.workers.dev)
 * 6. In Kit: Settings → Webhooks → Add webhook
 *    URL: your Worker URL
 *    Event: broadcast.sent
 */

export default {
  async fetch(request, env) {
    // Only accept POST requests
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Verify the shared secret Kit sends as a query param or header
    // Kit sends it as X-Kit-Signature or you can check a shared secret param
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret");
    if (secret !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Kit broadcast.sent webhook payload includes the broadcast object
    const broadcastId = body?.broadcast?.id;
    const subject = body?.broadcast?.subject ?? "unknown";

    if (!broadcastId) {
      return new Response("No broadcast ID in payload", { status: 400 });
    }

    console.log(`Received Kit webhook for broadcast: "${subject}" (id: ${broadcastId})`);

    // Fire GitHub Actions repository_dispatch
    const githubResponse = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "kit-webhook-bridge",
        },
        body: JSON.stringify({
          event_type: "newsletter_published",
          client_payload: {
            broadcast_id: broadcastId,
            subject,
          },
        }),
      }
    );

    if (!githubResponse.ok) {
      const errorText = await githubResponse.text();
      console.error(`GitHub dispatch failed: ${githubResponse.status} ${errorText}`);
      return new Response("Failed to trigger GitHub Actions", { status: 500 });
    }

    console.log(`✅ GitHub Actions triggered for broadcast: "${subject}"`);
    return new Response("OK", { status: 200 });
  },
};
