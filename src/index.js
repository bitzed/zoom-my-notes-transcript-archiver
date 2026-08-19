// index.js — entry point. Starts the onboarding server and the WS listener
// together, so a single `npm start` runs the whole PoC.
import { config } from "./config.js";
import { log } from "./logger.js";
import { startServer } from "./onboarding/server.js";
import { startListener } from "./ws/listener.js";

async function main() {
  log("app.start", {
    port: config.port,
    dataDir: config.dataDir,
    wsUrl: config.wsUrl,
    subscriptionId: config.wsSubscriptionId,
  });

  // Onboarding first so a user can /connect immediately.
  await startServer();

  // Then start receiving events.
  startListener();

  log("app.ready", { connectUrl: `http://localhost:${config.port}/connect` });
}

// Never swallow a startup failure.
main().catch((err) => {
  log("app.fatal", { error: String(err?.stack || err) }, "error");
  process.exit(1);
});

// Surface unhandled errors instead of dying silently.
process.on("unhandledRejection", (reason) => {
  log("app.unhandled_rejection", { reason: String(reason?.stack || reason) }, "error");
});
process.on("uncaughtException", (err) => {
  log("app.uncaught_exception", { error: String(err?.stack || err) }, "error");
});
