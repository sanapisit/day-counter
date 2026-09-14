import { AppConstants } from "../constants/app";
import { HeaderConstants } from "../constants/headers";
import { Config } from "../preload";
import { withTimeout } from "../utils/async";
import { getNextMidnightMs } from "../utils/date";
import { getImage, type ImageSize } from "./image-cache";

// ค่าที่ไม่ใช่ตัวเลขจะกลายเป็น NaN แล้วตกไม่ผ่านเงื่อนไขนี้เหมือนกัน
const parseSize = (searchParams: URLSearchParams): ImageSize | null => {
  const w = Number(
    searchParams.get(AppConstants.QUERY_WIDTH) ?? Config.DEFAULT_WIDTH,
  );
  const h = Number(
    searchParams.get(AppConstants.QUERY_HEIGHT) ?? Config.DEFAULT_HEIGHT,
  );

  const isValid =
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= AppConstants.MIN_WIDTH &&
    h >= AppConstants.MIN_HEIGHT &&
    w <= AppConstants.MAX_WIDTH &&
    h <= AppConstants.MAX_HEIGHT;

  return isValid ? { w, h } : null;
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

export const dayCounter = async (
  searchParams: URLSearchParams,
): Promise<Response> => {
  const size = parseSize(searchParams);
  if (!size) {
    return new Response("Unsupported size", { status: 400 });
  }

  // timeout กัน request ค้าง — งานที่ค้างไม่ได้ถูกยกเลิก และ entry ยังอยู่ใน
  // cache ต่อ request ถัดไปจึงได้ผลลัพธ์เดิมไปเลย
  const buffer = await withTimeout(
    getImage(size),
    AppConstants.RENDER_TIMEOUT_MS,
    "Canvas generation timed out",
  );

  return new Response(buffer as BodyInit, { headers: imageHeaders() });
};
