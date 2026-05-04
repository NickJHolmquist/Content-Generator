import "dotenv/config";
import fs from "fs";

const token = process.env.THREADS_ACCESS_TOKEN;
if (!token) {
  console.error("THREADS_ACCESS_TOKEN not set in .env");
  process.exit(1);
}

const url = new URL("https://graph.threads.net/refresh_access_token");
url.searchParams.set("grant_type", "th_refresh_token");
url.searchParams.set("access_token", token);

const res = await fetch(url.toString());
const body = await res.json();

if (!res.ok || !body.access_token) {
  console.error(`Refresh failed (${res.status}):`, JSON.stringify(body, null, 2));
  process.exit(1);
}

const expiresInDays = Math.floor(body.expires_in / 86400);

let env = fs.readFileSync(".env", "utf-8");
env = env.replace(/^THREADS_ACCESS_TOKEN=.*/m, `THREADS_ACCESS_TOKEN=${body.access_token}`);
fs.writeFileSync(".env", env);

console.log(`Token refreshed — expires in ${expiresInDays} days`);
console.log("Update GitHub Secret THREADS_ACCESS_TOKEN with the new value from .env");
