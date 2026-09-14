import { AppConstants } from "../constants/app";
import { Config } from "../preload";
import { getTemplate, onTemplateReload } from "../preload/template";
import { renderImage } from "../render/canvas";
import { createDebouncedTask, createSemaphore } from "../utils/async";
import { getNextMidnightMs, getToday } from "../utils/date";
import { Logs } from "../utils/log";

export type ImageSize = { w: number; h: number };

const sizeKey = ({ w, h }: ImageSize) => `${w}x${h}`;

// บน Pi ที่มี 2 CPU การปล่อยให้ทุกขนาด render พร้อมกันทำให้ทุกอันช้าลงพร้อมกัน
// จนชน timeout และยังทำให้ peak memory พุ่งเกิน mem_limit 256m
const renderSlots = createSemaphore(AppConstants.MAX_CONCURRENT_RENDERS);

// ภาพของ "วันนี้" แยกตามขนาด — เก็บเป็น promise เพื่อให้ request ที่มาพร้อมกัน
// ใช้ผลของ render เดียว
const cachedImages = new Map<string, Promise<Buffer>>();
let cachedDate: string | null = null;

// ขนาดที่เคยถูกขอ — อยู่ข้ามวัน (ต่างจาก cachedImages) เพื่อใช้ pre-warm ตอนเที่ยงคืน
const hotSizes = new Map<string, ImageSize>();

// FIFO (ไม่ใช่ LRU) — พอสำหรับกันไม่ให้ memory โตไม่จำกัด
const evictOldest = <T>(map: Map<string, T>) => {
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
};

const rememberSize = (key: string, size: ImageSize) => {
  if (hotSizes.has(key)) return;

  if (hotSizes.size >= AppConstants.MAX_CACHED_IMAGES) evictOldest(hotSizes);
  hotSizes.set(key, size);
};

export const getImage = (size: ImageSize): Promise<Buffer> => {
  const today = getToday();

  if (cachedDate !== today) {
    cachedDate = today;
    cachedImages.clear();
  }

  const key = sizeKey(size);

  // จำขนาดไว้ก่อน แม้จะ hit cache ก็ตาม เพื่อให้ pre-warm รู้ว่าต้องอุ่นอะไรบ้าง
  rememberSize(key, size);

  const cached = cachedImages.get(key);
  if (cached) return cached;

  if (cachedImages.size >= AppConstants.MAX_CACHED_IMAGES) {
    evictOldest(cachedImages);
  }

  // เก็บ promise แบบ synchronous ก่อน await เสมอ ไม่งั้น request ที่เข้ามาพร้อมกัน
  // จะเห็น cache ว่าง แล้วต่างคนต่างสั่ง render ของตัวเอง
  const pending = renderSlots
    .run(() => renderImage(size.w, size.h, today))
    .catch((err) => {
      cachedImages.delete(key);
      throw err;
    });

  cachedImages.set(key, pending);

  return pending;
};

// ---------------------------------------------------------------------------
// Pre-warm
// ---------------------------------------------------------------------------
// อุ่น cache ทีละขนาด (ไม่ขนาน) — ให้ request จริงแทรกเข้ามาใช้ slot ได้
let warming: Promise<void> | null = null;

const warmHotSizes = async () => {
  for (const size of [...hotSizes.values()]) {
    try {
      await getImage(size);
    } catch (err) {
      Logs.log(`warm ${sizeKey(size)} failed: ${(err as Error).message}`);
    }
  }
};

const runWarm = (): Promise<void> => {
  warming ??= warmHotSizes().finally(() => {
    warming = null;
  });

  return warming;
};

// debounce: clearCache() อาจถูกเรียกรัวๆ (fs.watch ยิงซ้ำ) ถ้าอุ่นทันที ภาพที่
// เพิ่งอุ่นเสร็จจะโดน clear รอบถัดไปล้างทิ้ง กลายเป็น render ฟรี
const scheduleWarm = createDebouncedTask(AppConstants.WARM_DEBOUNCE_MS, () => {
  if (hotSizes.size > 0) void runWarm();
});

// template เพิ่งเปลี่ยน: ของเดิมใช้ไม่ได้แล้ว รวมถึง entry ที่ยัง render ค้างอยู่
// แล้วอุ่นใหม่เบื้องหลัง จะได้ไม่ผลักภาระ render ไปให้ request แรกที่เข้ามา
const clearCache = () => {
  cachedImages.clear();
  Logs.log("clear canvas cache");
  scheduleWarm();
};

// ---------------------------------------------------------------------------
// Rollover: render ภาพของวันใหม่ล่วงหน้า ไม่ใช่รอให้ request แรกเป็นคนจ่าย
// ---------------------------------------------------------------------------
let rolloverTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleRollover = () => {
  if (rolloverTimer) clearTimeout(rolloverTimer);

  const delay =
    getNextMidnightMs() - Date.now() + AppConstants.ROLLOVER_GRACE_MS;

  rolloverTimer = setTimeout(() => {
    // ตั้งรอบถัดไปก่อนเสมอ เพื่อไม่ให้ error ระหว่างอุ่น cache ทำให้ลูปขาด
    scheduleRollover();
    Logs.log("date rollover: warming cache");
    void runWarm();
  }, Math.max(1, delay));

  // อย่าให้ timer กันไม่ให้ process ปิดตัวตอน shutdown
  rolloverTimer.unref();

  Logs.log(`next rollover warm in ${Math.round(delay / 1000)}s`);
};

// เรียกจาก index.ts หลัง server ขึ้นแล้ว
export const warmup = async () => {
  onTemplateReload(clearCache);

  try {
    // โหลด template ก่อน: การโหลดครั้งแรกจะล้าง cache ซึ่งเดิมไปล้าง entry ของ
    // request แรกที่กำลัง render อยู่ ทำให้ภาพแรกไม่เคยถูก cache
    await getTemplate();
    await getImage({ w: Config.DEFAULT_WIDTH, h: Config.DEFAULT_HEIGHT });
    Logs.log("warmup done");
  } catch (err) {
    Logs.log(`warmup failed: ${(err as Error).message}`);
  } finally {
    scheduleRollover();
  }
};
