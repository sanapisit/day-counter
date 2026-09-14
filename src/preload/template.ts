import { Image, loadImage } from "@napi-rs/canvas";
import { watch } from "node:fs";
import { AppConstants } from "../constants/app";
import { createDebouncedTask } from "../utils/async";
import { Logs } from "../utils/log";

let cachedImage: Image | null = null;

// "load in progress" guard — prevents concurrent requests from
// independently loading the template during initial load or reload.
let loading: Promise<Image> | null = null;

// ผู้ที่ถือ cache ที่อิงกับ template (เช่น image cache) มาสมัครรับแจ้งเตือนได้
// เพื่อล้างของเก่าทิ้งเมื่อไฟล์ถูกเขียนทับ — โมดูลนี้จึงไม่ต้องรู้จักใครเลย
const reloadListeners = new Set<() => void>();

export const onTemplateReload = (listener: () => void) => {
  reloadListeners.add(listener);
};

const loadTemplate = async (): Promise<Image> => {
  Logs.log("load Template");

  const bytes = await Bun.file(AppConstants.TEMPLATE_PATH).bytes();
  cachedImage = await loadImage(bytes);

  for (const listener of reloadListeners) listener();

  return cachedImage;
};

// โหลดผ่าน guard เสมอ เพื่อให้ผู้เรียกที่มาพร้อมกันใช้ผลลัพธ์เดียวกัน
const load = (): Promise<Image> => {
  loading ??= loadTemplate().finally(() => {
    loading = null;
  });

  return loading;
};

export const getTemplate = async (): Promise<Image> => cachedImage ?? load();

const reload = async () => {
  try {
    // ปล่อยให้รอบที่ค้างอยู่จบก่อน แล้วค่อยโหลดทับด้วยไฟล์ใหม่
    if (loading) await loading;
    await load();
  } catch (err) {
    Logs.log(`Template reload failed: ${(err as Error).message}`);
  }
};

// fs.watch ยิง event หลายครั้งต่อการเขียนไฟล์ครั้งเดียว (ทั้งบน Linux และ Windows)
// ถ้า reload ทุก event ภาพที่ warm cache เพิ่งสร้างเสร็จจะโดนล้างทิ้งซ้ำๆ
const scheduleReload = createDebouncedTask(
  AppConstants.TEMPLATE_RELOAD_DEBOUNCE_MS,
  () => void reload(),
);

watch(AppConstants.TEMPLATE_PATH, (event) => {
  if (event !== "change" && event !== "rename") return;

  Logs.log("Template changed: %s", event);
  scheduleReload();
});
