export const AppConstants = {
  TEMPLATE_PATH: "assets/images/template.png",

  FONT_PATH: "assets/fonts/Prompt-Bold.ttf",
  FONT_NAME: "Prompt",

  HEIGHT: "height",
  WIDTH: "width",

  MIN_WIDTH: 1,
  MIN_HEIGHT: 1,
  MAX_WIDTH: 1500, // iPhone 17 Pro Max 1320 x 2868
  MAX_HEIGHT: 3000,

  // caps distinct w x h combos held in memory at once; RPi 3B+ only has 1GB RAM
  MAX_CACHED_IMAGES: 8,

  // docker-compose pins the container to 2 CPUs and 256m. Each 1179x2556 render
  // holds a ~12MB canvas + blur canvas + encoder buffers, and the webp encode
  // (the expensive half of a render) runs on the libuv threadpool — so letting
  // every distinct size render at once just thrashes CPU and memory.
  MAX_CONCURRENT_RENDERS: 2,

  // ยอมให้ render นานสุดเท่านี้ก่อนตอบ error
  RENDER_TIMEOUT_MS: 30_000,

  // หน่วงหลังเที่ยงคืนนิดหน่อย กัน timer ตื่นก่อนวันเปลี่ยนจริงจาก clock drift
  ROLLOVER_GRACE_MS: 2_000,

  // fs.watch ยิง event หลายครั้งต่อการเขียนไฟล์ครั้งเดียว — รวบให้เหลือ reload เดียว
  TEMPLATE_RELOAD_DEBOUNCE_MS: 200,

  // อุ่น cache หลัง clear ครั้งสุดท้ายนิ่งแล้ว ไม่งั้นภาพที่เพิ่งอุ่นจะโดน clear
  // รอบถัดไปล้างทิ้ง (ต้องมากกว่า TEMPLATE_RELOAD_DEBOUNCE_MS)
  WARM_DEBOUNCE_MS: 500,

  // อายุ cache ฝั่ง client (วินาที) — จะถูกหั่นไม่ให้ข้ามเที่ยงคืน
  IMAGE_MAX_AGE_SECONDS: 300,
} as const;
