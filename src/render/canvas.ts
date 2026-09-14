import { createCanvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { AppConstants } from "../constants/app";
import { Config } from "../preload";
import { getTemplate } from "../preload/template";
import { Logs } from "../utils/log";
import { drawGlassPanel, type GlassPanel } from "./glass-panel";
import { getTextLines } from "./text";

const LINE_HEIGHT_RATIO = 1.2;

// วาด template แบบ cover: ขยายให้เต็มกรอบแล้ว center ส่วนที่เกินถูกตัดทิ้ง
const drawTemplateCover = (
  ctx: SKRSContext2D,
  template: Image,
  w: number,
  h: number,
) => {
  const scale = Math.max(w / template.width, h / template.height);

  const drawWidth = Math.floor(template.width * scale);
  const drawHeight = Math.floor(template.height * scale);
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
};

// กรอบถูกกำหนดขนาดจากข้อความที่วัดได้ แล้ว clamp ไม่ให้ล้น canvas
// หมายเหตุ: ตัวข้อความเองไม่ถูกตัดหรือขึ้นบรรทัดใหม่ ชื่อที่ยาวเกินจะล้นกรอบ
const layoutPanel = (
  w: number,
  h: number,
  fontSize: number,
  textWidth: number,
  textHeight: number,
): GlassPanel => {
  const paddingX = fontSize * 1.1;
  const paddingY = fontSize * 0.8;

  const x = w / 10;
  const y = Math.max(0, h / 2 - textHeight / 2 - paddingY);
  const width = Math.min(textWidth + paddingX * 2, w - x);
  const height = Math.min(textHeight + paddingY * 2, h - y);

  return {
    x,
    y,
    width,
    height,
    radius: Math.min(fontSize * 0.9, width / 2, height / 2),
  };
};

// ไม่ใช้ shadowBlur กับ fillText: มันคำนวณเบลอแยกทุกบรรทัด ทำให้ช้ากว่ากรอบ
// กระจกทั้งอันหลายเท่า และกรอบกระจกให้ contrast พอสำหรับอ่านออกอยู่แล้ว
const drawTextLines = (
  ctx: SKRSContext2D,
  lines: string[],
  panel: GlassPanel,
  h: number,
  fontSize: number,
  lineHeight: number,
) => {
  const marginX = fontSize * 0.5; // ระยะห่างระหว่างข้อความกับขอบกรอบ

  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // เริ่มวาดจากกึ่งกลาง — ยักไปขวาเพื่อให้ออกห่างขอบกรอบ
  let y = h / 2 - (lines.length * lineHeight) / 2 + lineHeight / 2;
  for (const line of lines) {
    ctx.fillText(line, panel.x + marginX, y);
    y += lineHeight;
  }
};

export const renderImage = async (
  w: number,
  h: number,
  today: string,
): Promise<Buffer> => {
  Logs.log("genCanvas");

  const template = await getTemplate();

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  drawTemplateCover(ctx, template, w, h);

  // FONT_SIZE เป็นค่าสัมบูรณ์ ไม่ผูกกับ w/h ที่ร้องขอมา
  const fontSize = Config.FONT_SIZE;
  ctx.font = `${fontSize}px ${AppConstants.FONT_NAME}`;

  const lines = getTextLines(today);
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  const textHeight = lines.length * lineHeight;
  const textWidth = Math.max(
    ...lines.map((line) => ctx.measureText(line).width),
  );

  const panel = layoutPanel(w, h, fontSize, textWidth, textHeight);

  drawGlassPanel(canvas, ctx, panel);
  drawTextLines(ctx, lines, panel, h, fontSize, lineHeight);

  return canvas.encode("webp", AppConstants.WEBP_QUALITY);
};
