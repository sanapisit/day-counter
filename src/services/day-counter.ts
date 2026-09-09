import { Temporal } from "@js-temporal/polyfill";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { AppConstants } from "../constants/app";
import { HeaderConstants } from "../constants/headers";
import { RegexConstants } from "../constants/regex";
import { TZConstants } from "../constants/tz";
import { Config } from "../preload";
import { getTemplate } from "../preload/template";
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

  // Timeout canvas generation after 30s — prevent hung requests
  const timeoutMs = 30_000;
  const buffer = await Promise.race([
    getCanvas(w, h),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Canvas generation timed out")),
        timeoutMs,
      ),
    ),
  ]);

  return new Response(buffer as BodyInit, {
    headers: HeaderConstants.IMAGE_HEADERS,
  });
};

const cachedCanvas: Map<string, Promise<Buffer<ArrayBufferLike>>> = new Map();
let lastGenCanvas: string;

export const clearCanvasCache = () => {
  cachedCanvas.clear();
};
const getCanvas = (w: number, h: number) => {
  const today = Temporal.Now.zonedDateTimeISO(TZConstants.TH)
    .toPlainDate()
    .toString();

  if (lastGenCanvas !== today) {
    lastGenCanvas = today;
    cachedCanvas.clear();
  }

  const key = `${w}x${h}`;
  const cached = cachedCanvas.get(key);
  if (cached) return cached;

  // evict oldest entry first so concurrent distinct sizes can't grow memory unbounded
  if (cachedCanvas.size >= AppConstants.MAX_CACHED_IMAGES) {
    const oldestKey = cachedCanvas.keys().next().value;
    if (oldestKey !== undefined) cachedCanvas.delete(oldestKey);
  }

  // store the promise synchronously so concurrent requests for the same size
  // await the same in-flight generation instead of each triggering their own
  const pending = genCanvas(w, h, today).catch((err) => {
    cachedCanvas.delete(key);
    throw err;
  });
  cachedCanvas.set(key, pending);

  return pending;
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
  // validate format YYYY-MM-DD
  if (!RegexConstants.DATE.test(input)) {
    return {
      passed: "Invalid date",
      countdownDays: "Invalid date",
    };
  }

  let baseDate: Temporal.PlainDate;
  try {
    baseDate = Temporal.PlainDate.from(input);
  } catch {
    return {
      passed: "Invalid date",
      countdownDays: "Invalid date",
    };
  }

  let today: Temporal.PlainDate;
  try {
    today = todayStr
      ? Temporal.PlainDate.from(todayStr)
      : Temporal.Now.zonedDateTimeISO(TZConstants.TH).toPlainDate();
  } catch {
    return {
      passed: "Invalid date",
      countdownDays: "Invalid date",
    };
  }

  const cmp = Temporal.PlainDate.compare(today, baseDate);
  const isPast = cmp >= 0;

  // ===== 1) เวลาที่ผ่านมา =====
  let diffYMD: { years: number; months: number; days: number };
  let totalDays = 0;
  try {
    diffYMD = isPast
      ? baseDate.until(today, { largestUnit: "years" })
      : today.until(baseDate, { largestUnit: "years" });
    totalDays = isPast
      ? baseDate.until(today, { largestUnit: "days" }).days
      : 0;
  } catch {
    return {
      passed: "Error",
      countdownDays: "Error",
    };
  }

  // ===== 2) Countdown แบบวนรายปี =====
  let nextOccurrence: Temporal.PlainDate;

  try {
    nextOccurrence = baseDate.with({ year: today.year });
  } catch {
    // handle leap year เช่น 29 Feb
    nextOccurrence = Temporal.PlainDate.from({
      year: today.year,
      month: baseDate.month,
      day: 28,
    });
  }

  try {
    if (Temporal.PlainDate.compare(today, nextOccurrence) > 0) {
      nextOccurrence = nextOccurrence.add({ years: 1 });
    }

    const countdownDays = today.until(nextOccurrence, {
      largestUnit: "days",
    }).days;

    return {
      passed: `${diffYMD.years}y${diffYMD.months}m${diffYMD.days}d | ${totalDays}d`,
      countdownDays: `${countdownDays}d`,
    };
  } catch {
    return {
      passed: `${diffYMD.years}y${diffYMD.months}m${diffYMD.days}d | ${totalDays}d`,
      countdownDays: "Error",
    };
  }
};
