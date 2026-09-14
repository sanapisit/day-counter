import { AppConstants } from "./constants/app";
import { Config } from "./preload";
import { createServer } from "./server";
import { warmup } from "./services/image-cache";
import { Logs } from "./utils/log";

const server = createServer();

Logs.log(
  `Running in ${Config.NODE_ENV} on http://${Config.HOST}:${Config.PORT}`,
);

// อุ่น cache เบื้องหลัง: /health ต้องตอบได้ทันทีโดยไม่รอ render ภาพแรก
void warmup();

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;

  Logs.log("Shutting down...");
  server.stop(false);

  // รอ request ที่ค้างอยู่ทำงานจบก่อน
  await Bun.sleep(AppConstants.SHUTDOWN_DRAIN_MS);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
