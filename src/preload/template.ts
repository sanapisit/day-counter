import { Image, loadImage } from "@napi-rs/canvas";
import { watch } from "node:fs";
import { AppConstants } from "../constants/app";
import { clearCanvasCache } from "../services/day-counter";
import { Logs } from "../utils/log";

let cachedImage: Image | null = null;

// "load in progress" guard — prevents concurrent requests from
// independently loading the template during initial load or reload.
let loading: Promise<Image> | null = null;

const loadTemplate = async (): Promise<Image> => {
  Logs.log("load Template");

  const bytes = await Bun.file(AppConstants.TEMPLATE_PATH).bytes();
  cachedImage = await loadImage(bytes);

  clearCanvasCache();
  Logs.log("clear canvas cache");
  return cachedImage;
};

export const getTemplate = async (): Promise<Image> => {
  if (cachedImage) return cachedImage;

  // If a load is already in progress, await it instead of starting another
  if (loading) return loading;

  loading = loadTemplate().finally(() => {
    loading = null;
  });
  return loading;
};

watch(AppConstants.TEMPLATE_PATH, async (event) => {
  if (event === "change" || event === "rename") {
    try {
      Logs.log("Template changed: %s", event);
      // Reuse the dedup guard so concurrent requests don't reload too
      if (loading) await loading;
      loading = loadTemplate().finally(() => {
        loading = null;
      });
      await loading;
    } catch (err) {
      loading = null;
      console.error("Template reload failed:", err);
    }
  }
});
