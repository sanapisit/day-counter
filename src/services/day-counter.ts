import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { AppConstants } from "../constants/app";
import { HeaderConstants } from "../constants/headers";
import { Config } from "../preload";
import { getTemplate } from "../preload/template";
import {
  diffDays,
  diffYearsMonthsDays,
  getToday,
  nextMidnightMs,
  nextYearlyOccurrence,
  parseEnvDate,
  parseIsoDate,
} from "../utils/date";
import { Logs } from "../utils/log";

export const dayCounter = async (
  searchParams: URLSearchParams,
): Promise<Response> => {
  const w = Number(
    searchParams.get(AppConstants.WIDTH) ?? Config.DEFAULT_WIDTH,
  );
  const h = Number(
    searchParams.get(AppConstants.HEIGHT) ?? Config.DEFAULT_HEIGHT,
  );

  const isValidSize =
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= AppConstants.MIN_WIDTH &&
    h >= AppConstants.MIN_HEIGHT &&
    w <= AppConstants.MAX_WIDTH &&
    h <= AppConstants.MAX_HEIGHT;

  if (!isValidSize) {
    return new Response("Unsupported size", { status: 400 });
  }

  // Timeout canvas generation — prevent hung requests. หมายเหตุ: race ไม่ได้
  // ยกเลิกงานที่ค้างอยู่ แต่ entry ยังอยู่ใน cache ต่อ request ถัดไปจึงได้ผลลัพธ์เดิม
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const buffer = await Promise.race([
      getCanvas(w, h),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Canvas generation timed out")),
          AppConstants.RENDER_TIMEOUT_MS,
        );
      }),
    ]);

    return new Response(buffer as BodyInit, { headers: imageHeaders() });
  } finally {
    // ไม่เคลียร์ = ทุก request ทิ้ง timer ค้าง event loop ไว้ 30 วินาที
    clearTimeout(timer);
  }
};

// เที่ยงคืนถัดไป (epoch ms) — คำนวณวันละครั้งแล้ว cache ไว้
let cachedMidnightMs = 0;
const getNextMidnightMs = (): number => {
  if (Date.now() >= cachedMidnightMs) {
    cachedMidnightMs = nextMidnightMs();
  }

  return cachedMidnightMs;
};

// อย่าให้ cache ฝั่ง client ข้ามเที่ยงคืน ไม่งั้น widget จะค้างภาพของเมื่อวาน
const imageHeaders = () => {
  const secondsLeft = Math.ceil((getNextMidnightMs() - Date.now()) / 1000);
  const maxAge = Math.max(
    1,
    Math.min(AppConstants.IMAGE_MAX_AGE_SECONDS, secondsLeft),
  );

  return {
    "Content-Type": HeaderConstants.IMAGE_CONTENT_TYPE,
    "Cache-Control": `public, max-age=${maxAge}`,
  };
};

// ---------------------------------------------------------------------------
// จำกัดจำนวน render ที่วิ่งพร้อมกัน
// ---------------------------------------------------------------------------
// บน Pi ที่มี 2 CPU การปล่อยให้ทุกขนาด render พร้อมกันทำให้ทุกอันช้าลงพร้อมกัน
// จนชน timeout และยังทำให้ peak memory พุ่งเกิน mem_limit 256m
let activeRenders = 0;
const renderWaiters: Array<() => void> = [];

const acquireRenderSlot = (): Promise<void> => {
  if (activeRenders < AppConstants.MAX_CONCURRENT_RENDERS) {
    activeRenders++;
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => renderWaiters.push(resolve));
};

const releaseRenderSlot = () => {
  const next = renderWaiters.shift();
  // ส่งต่อ slot ให้คิวถัดไปโดยไม่ลด activeRenders
  if (next) next();
  else activeRenders--;
};

// ---------------------------------------------------------------------------
// Cache + pre-warm
// ---------------------------------------------------------------------------
const cachedCanvas: Map<string, Promise<Buffer<ArrayBufferLike>>> = new Map();
let lastGenCanvas: string;

// ขนาดที่เคยถูกขอ — เก็บข้ามวันเพื่อใช้ pre-warm ตอนเที่ยงคืน
const hotSizes: Map<string, { w: number; h: number }> = new Map();

export const clearCanvasCache = () => {
  cachedCanvas.clear();
  // template เพิ่งเปลี่ยน: อุ่น cache ใหม่แบบเบื้องหลัง จะได้ไม่ผลักภาระ
  // การ render ไปให้ request แรกที่เข้ามา
  scheduleWarm();
};

const getCanvas = (w: number, h: number) => {
  const today = getToday();

  if (lastGenCanvas !== today) {
    lastGenCanvas = today;
    cachedCanvas.clear();
  }

  const key = `${w}x${h}`;

  // จำขนาดไว้ก่อน แม้จะ hit cache ก็ตาม เพื่อให้ pre-warm รู้ว่าต้องอุ่นอะไรบ้าง
  if (!hotSizes.has(key)) {
    if (hotSizes.size >= AppConstants.MAX_CACHED_IMAGES) {
      const oldest = hotSizes.keys().next().value;
      if (oldest !== undefined) hotSizes.delete(oldest);
    }
    hotSizes.set(key, { w, h });
  }

  const cached = cachedCanvas.get(key);
  if (cached) return cached;

  // evict oldest entry first so concurrent distinct sizes can't grow memory unbounded
  if (cachedCanvas.size >= AppConstants.MAX_CACHED_IMAGES) {
    const oldestKey = cachedCanvas.keys().next().value;
    if (oldestKey !== undefined) cachedCanvas.delete(oldestKey);
  }

  // store the promise synchronously so concurrent requests for the same size
  // await the same in-flight generation instead of each triggering their own
  const pending = renderWithSlot(w, h, today).catch((err) => {
    cachedCanvas.delete(key);
    throw err;
  });
  cachedCanvas.set(key, pending);

  return pending;
};

const renderWithSlot = async (w: number, h: number, today: string) => {
  await acquireRenderSlot();
  try {
    return await genCanvas(w, h, today);
  } finally {
    releaseRenderSlot();
  }
};

// อุ่น cache ทีละขนาด (ไม่ขนาน) — ให้ request จริงแทรกเข้ามาใช้ slot ได้
let warming: Promise<void> | null = null;

const warmCache = async () => {
  for (const { w, h } of [...hotSizes.values()]) {
    try {
      await getCanvas(w, h);
    } catch (err) {
      Logs.log(`warm ${w}x${h} failed: ${(err as Error).message}`);
    }
  }
};

const runWarm = (): Promise<void> => {
  if (warming) return warming;

  warming = warmCache().finally(() => {
    warming = null;
  });

  return warming;
};

let warmTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleWarm = () => {
  if (hotSizes.size === 0) return;

  // debounce: clearCanvasCache() อาจถูกเรียกรัวๆ (fs.watch ยิงซ้ำ) ถ้าอุ่นทันที
  // ภาพที่เพิ่งอุ่นเสร็จจะโดน clear รอบถัดไปล้างทิ้ง กลายเป็น render ฟรี
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warmTimer = null;
    void runWarm();
  }, AppConstants.WARM_DEBOUNCE_MS);
  warmTimer.unref();
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
  try {
    // โหลด template ก่อน: การโหลดครั้งแรกจะเรียก clearCanvasCache() ซึ่งเดิมไป
    // ล้าง entry ของ request แรกที่กำลัง render อยู่ ทำให้ภาพแรกไม่เคยถูก cache
    await getTemplate();
    await getCanvas(Config.DEFAULT_WIDTH, Config.DEFAULT_HEIGHT);
    Logs.log("warmup done");
  } catch (err) {
    Logs.log("warmup failed: " + (err as Error).message);
  } finally {
    scheduleRollover();
  }
};

const genCanvas = async (w: number, h: number, today: string) => {
  Logs.log("genCanvas");
  const template = await getTemplate();

  // ---- คำนวณ scale แบบ cover (เต็มกรอบ อาจตัดส่วนเกิน) ----
  const scale = Math.max(w / template.width, h / template.height);

  const drawWidth = Math.floor(template.width * scale);
  const drawHeight = Math.floor(template.height * scale);

  // สร้าง canvas ขนาดตาม request
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  // center ภาพ
  const offsetX = Math.floor((w - drawWidth) / 2);
  const offsetY = Math.floor((h - drawHeight) / 2);

  ctx.drawImage(
    template,
    0,
    0,
    template.width,
    template.height,
    offsetX,
    offsetY,
    drawWidth,
    drawHeight,
  );

  // ---- เตรียมข้อความ ----
  const fontSize = Config.FONT_SIZE;
  ctx.font = `${fontSize}px ${AppConstants.FONT_NAME}`;

  const lines = getText(today);
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;
  const maxLineWidth = Math.max(
    ...lines.map((line) => ctx.measureText(line).width),
  );

  // ---- กรอบ Liquid Glass ล้อมข้อความ ----
  const paddingX = fontSize * 1.1;
  const paddingY = fontSize * 0.8;
  const marginX = fontSize * 0.5; // ระยะห่างระหว่างข้อความกบขอบกรอบ
  const panelX = w / 10;
  const panelY = Math.max(0, h / 2 - totalHeight / 2 - paddingY);
  const panelWidth = Math.min(maxLineWidth + paddingX * 2, w - panelX);
  const panelHeight = Math.min(totalHeight + paddingY * 2, h - panelY);
  const panelRadius = Math.min(fontSize * 0.9, panelWidth / 2, panelHeight / 2);

  drawGlassPanel(
    canvas,
    ctx,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    panelRadius,
  );

  // ---- เขียนข้อความ ----
  // ไม่ใช้ shadowBlur กับ fillText: มันคำนวณเบลอแยกทุกบรรทัด ทำให้ช้ากว่ากรอบ
  // กระจกทั้งอันหลายเท่า และกรอบกระจกให้ contrast พอสำหรับอ่านออกอยู่แล้ว
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // เริ่มวาดจากกึ่งกลาง — ยักไปขวาเพื่อให้ออกห่างขอบกรอบ
  let startY = h / 2 - totalHeight / 2 + lineHeight / 2;
  for (const line of lines) {
    ctx.fillText(line, panelX + marginX, startY);
    startY += lineHeight;
  }

  const buffer = await canvas.encode("webp", 85);

  return buffer;
};

// วาดกรอบสไตล์ iOS Liquid Glass: เบลอเฉพาะพื้นหลังในกรอบ (ไม่เบลอทั้งภาพ
// เพื่อลดต้นทุนการประมวลผลบน Raspberry Pi) แล้วซ้อน tint/sheen/ขอบใส
const drawGlassPanel = (
  canvas: Canvas,
  ctx: ReturnType<Canvas["getContext"]>,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  if (width <= 0 || height <= 0) return;

  const tracePanel = () => {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  };

  // เงานุ่มยกกรอบออกจากพื้นหลัง
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = radius;
  ctx.shadowOffsetY = radius * 0.3;
  ctx.fillStyle = "rgba(0, 0, 0, 0.01)";
  tracePanel();
  ctx.fill();
  ctx.restore();

  // เบลอเฉพาะส่วนพื้นหลังที่อยู่ใต้กรอบ (บวกระยะ bleed กันขอบเบลอโผล่)
  const blurRadius = Math.round(radius);
  const bleed = blurRadius * 2;
  const cropX = Math.max(0, x - bleed);
  const cropY = Math.max(0, y - bleed);
  const cropWidth = Math.min(canvas.width, x + width + bleed) - cropX;
  const cropHeight = Math.min(canvas.height, y + height + bleed) - cropY;

  if (cropWidth > 0 && cropHeight > 0) {
    // Reuse pooled canvas — resize if needed
    if (blurCanvas.width !== cropWidth || blurCanvas.height !== cropHeight) {
      blurCanvas.width = cropWidth;
      blurCanvas.height = cropHeight;
    }
    blurCtx.filter = `blur(${blurRadius}px)`;
    blurCtx.drawImage(
      canvas,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    );

    ctx.save();
    tracePanel();
    ctx.clip();
    ctx.drawImage(blurCanvas, cropX, cropY);

    // milky tint (บางกว่าเดิมเพื่อให้เบลอพื้นหลังยังโปร่งแสงอยู่) + top sheen
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(x, y, width, height);

    const sheen = ctx.createLinearGradient(0, y, 0, y + height);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.45)");
    sheen.addColorStop(0.35, "rgba(255, 255, 255, 0.08)");
    sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  }

  // ขอบใสบางแบบ hairline
  ctx.save();
  const border = ctx.createLinearGradient(0, y, 0, y + height);
  border.addColorStop(0, "rgba(255, 255, 255, 0.7)");
  border.addColorStop(1, "rgba(255, 255, 255, 0.18)");
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(1, radius * 0.06);
  tracePanel();
  ctx.stroke();
  ctx.restore();
};

// Canvas pooling for blur — reuse a single canvas to reduce memory pressure on RPi
const blurCanvas = createCanvas(1, 1);
const blurCtx = blurCanvas.getContext("2d");

let cachedText: string[];
let lastGenText: string;
const getText = (today: string) => {
  if (lastGenText !== today) {
    lastGenText = today;
    cachedText = genText(today);
  }

  return cachedText;
};

const genText = (today: string) => {
  Logs.log("genText");

  const personName1 = Config.PERSON_NAME_1;
  const personBirthday1 = calculate(Config.PERSON_BIRTHDAY_1, today);
  const personName2 = Config.PERSON_NAME_2;
  const personBirthday2 = calculate(Config.PERSON_BIRTHDAY_2, today);
  const anniversary = calculate(Config.ANNIVERSARY, today);

  return [
    `${personName1} - ${personBirthday1.passed}`,
    `${personName2} - ${personBirthday2.passed}`,
    `Anniversary - ${anniversary.passed}`,
    "",
    "Countdown",
    `${personName1} - ${personBirthday1.countdownDays}`,
    `${personName2} - ${personBirthday2.countdownDays}`,
    `Anniversary - ${anniversary.countdownDays}`,
  ];
};
const calculate = (input: string, todayStr?: string) => {
  const invalid = {
    passed: "Invalid date",
    countdownDays: "Invalid date",
  };

  // env เก็บเป็น DD/MM/YYYY ปี พ.ศ. — parseEnvDate เช็คทั้งรูปแบบและความมีอยู่จริง
  const baseDate = parseEnvDate(input);
  if (!baseDate) return invalid;

  const today = todayStr ? parseIsoDate(todayStr) : parseIsoDate(getToday());
  if (!today) return invalid;

  const isPast = !today.isBefore(baseDate);

  // ===== 1) เวลาที่ผ่านมา =====
  const elapsed = isPast
    ? diffYearsMonthsDays(baseDate, today)
    : diffYearsMonthsDays(today, baseDate);
  const totalDays = isPast ? diffDays(baseDate, today) : 0;

  // ===== 2) Countdown แบบวนรายปี =====
  const nextOccurrence = nextYearlyOccurrence(baseDate, today);

  return {
    passed: `${elapsed.years}y${elapsed.months}m${elapsed.days}d | ${totalDays}d`,
    countdownDays: `${diffDays(today, nextOccurrence)}d`,
  };
};
