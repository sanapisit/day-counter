import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";

export type GlassPanel = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

// Canvas pooling for blur — reuse a single canvas to reduce memory pressure on RPi
const blurCanvas = createCanvas(1, 1);
const blurCtx = blurCanvas.getContext("2d");

const tracePanel = (ctx: SKRSContext2D, panel: GlassPanel) => {
  ctx.beginPath();
  ctx.roundRect(panel.x, panel.y, panel.width, panel.height, panel.radius);
};

// เงานุ่มยกกรอบออกจากพื้นหลัง
const drawShadow = (ctx: SKRSContext2D, panel: GlassPanel) => {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = panel.radius;
  ctx.shadowOffsetY = panel.radius * 0.3;
  ctx.fillStyle = "rgba(0, 0, 0, 0.01)";
  tracePanel(ctx, panel);
  ctx.fill();
  ctx.restore();
};

// เบลอเฉพาะส่วนพื้นหลังที่อยู่ใต้กรอบ (บวกระยะ bleed กันขอบเบลอโผล่) แล้วซ้อน
// tint บางๆ กับ sheen ด้านบน — ไม่เบลอทั้งภาพเพื่อลดต้นทุนบน Raspberry Pi
const drawBackdrop = (
  canvas: Canvas,
  ctx: SKRSContext2D,
  panel: GlassPanel,
) => {
  const { x, y, width, height } = panel;

  const blurRadius = Math.round(panel.radius);
  const bleed = blurRadius * 2;
  const cropX = Math.max(0, x - bleed);
  const cropY = Math.max(0, y - bleed);
  const cropWidth = Math.min(canvas.width, x + width + bleed) - cropX;
  const cropHeight = Math.min(canvas.height, y + height + bleed) - cropY;

  if (cropWidth <= 0 || cropHeight <= 0) return;

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
  tracePanel(ctx, panel);
  ctx.clip();
  ctx.drawImage(blurCanvas, cropX, cropY);

  // milky tint (บางพอให้เบลอพื้นหลังยังโปร่งแสงอยู่) + top sheen
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(x, y, width, height);

  const sheen = ctx.createLinearGradient(0, y, 0, y + height);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.45)");
  sheen.addColorStop(0.35, "rgba(255, 255, 255, 0.08)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
};

// ขอบใสบางแบบ hairline
const drawBorder = (ctx: SKRSContext2D, panel: GlassPanel) => {
  ctx.save();
  const border = ctx.createLinearGradient(0, panel.y, 0, panel.y + panel.height);
  border.addColorStop(0, "rgba(255, 255, 255, 0.7)");
  border.addColorStop(1, "rgba(255, 255, 255, 0.18)");
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(1, panel.radius * 0.06);
  tracePanel(ctx, panel);
  ctx.stroke();
  ctx.restore();
};

// วาดกรอบสไตล์ iOS Liquid Glass
export const drawGlassPanel = (
  canvas: Canvas,
  ctx: SKRSContext2D,
  panel: GlassPanel,
) => {
  if (panel.width <= 0 || panel.height <= 0) return;

  drawShadow(ctx, panel);
  drawBackdrop(canvas, ctx, panel);
  drawBorder(ctx, panel);
};
