import { Config } from "./preload";
import { createServer } from "./server";
import { warmup } from "./services/day-counter";
import { Logs } from "./utils/log";

const server = createServer();

Logs.log(
  `Running in ${Config.NODE_ENV} on http://${Config.HOST}:${Config.PORT}`,
);

// อุ่น cache เบื้องหลัง: /health ต้องตอบได้ทันทีโดยไม่รอ render ภาพแรก
void warmup();

const shutdown = async () => {
  Logs.log("Shutting down...");
  server.stop(false);
  // Wait up to 5s for pending requests to drain
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 5000);
  });
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
