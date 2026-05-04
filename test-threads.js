import "dotenv/config";

const token = process.env.THREADS_ACCESS_TOKEN;
if (!token) {
  console.error("THREADS_ACCESS_TOKEN not set in .env");
  process.exit(1);
}

const url = new URL("https://graph.threads.net/v1.0/me");
url.searchParams.set("fields", "id,username,threads_profile_picture_url");
url.searchParams.set("access_token", token);

const res = await fetch(url.toString());
const body = await res.json();

if (!res.ok) {
  console.error(`API error (${res.status}):`, JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log("Connected successfully:");
console.log(`  User ID:  ${body.id}`);
console.log(`  Username: ${body.username}`);
