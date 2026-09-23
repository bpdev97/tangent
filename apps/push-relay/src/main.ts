import { loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

const config = loadConfig(process.env);
const relay = await startServer(config);

console.log("T3 personal push relay listening", {
  url: relay.url,
  apnsEnvironment: config.apns.environment,
  bundleId: config.apns.bundleId,
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await relay.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
