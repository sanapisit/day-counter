use std::time::Duration;

pub const TEMPLATE_PATH: &str = "assets/images/template.png";
pub const FONT_PATH: &str = "assets/fonts/Prompt-Bold.ttf";

// ชื่อ query param ของ /day-counter
pub const QUERY_WIDTH: &str = "width";
pub const QUERY_HEIGHT: &str = "height";

pub const MIN_WIDTH: u32 = 1;
pub const MIN_HEIGHT: u32 = 1;
pub const MAX_WIDTH: u32 = 1500; // iPhone 17 Pro Max 1320 x 2868
pub const MAX_HEIGHT: u32 = 3000;

// caps distinct w x h combos held in memory at once; RPi 3B+ only has 1GB RAM
pub const MAX_CACHED_IMAGES: usize = 8;

// docker-compose pins the container to 2 CPUs and 256m. Each 1179x2556 render
// holds a ~12MB pixmap + a full-size clip mask + encoder buffers — letting every
// distinct size render at once just thrashes CPU and memory.
pub const MAX_CONCURRENT_RENDERS: usize = 2;

// คุณภาพ WebP — ลดต่ำกว่านี้แทบไม่ช่วยเรื่องเวลา encode (q50 เร็วขึ้นแค่ ~13%)
pub const WEBP_QUALITY: f32 = 85.0;

// ยอมให้ render นานสุดเท่านี้ก่อนตอบ error
pub const RENDER_TIMEOUT: Duration = Duration::from_secs(30);

// หน่วงหลังเที่ยงคืนนิดหน่อย กัน timer ตื่นก่อนวันเปลี่ยนจริงจาก clock drift
pub const ROLLOVER_GRACE_MS: i64 = 2_000;

// poll mtime/size ของ template แทน inotify: ทำงานกับ bind mount ของ docker และ
// การเขียนทับแบบ rename ได้ทุกกรณี และไม่ยิง event ซ้ำๆ จึงไม่ต้อง debounce
pub const TEMPLATE_POLL_INTERVAL: Duration = Duration::from_secs(1);

// อายุ cache ฝั่ง client (วินาที) — จะถูกหั่นไม่ให้ข้ามเที่ยงคืน
pub const IMAGE_MAX_AGE_SECONDS: i64 = 300;

// รอให้ request ที่ค้างอยู่ทำงานจบก่อนปิด process (สูงสุด)
pub const SHUTDOWN_DRAIN: Duration = Duration::from_secs(5);

// ไทยใช้ UTC+7 มาตั้งแต่ปี 1920 และไม่เคยมี DST จึง hardcode offset ได้
pub const TH_UTC_OFFSET_MS: i64 = 7 * 3_600_000;

// พ.ศ. = ค.ศ. + 543
pub const BUDDHIST_YEAR_OFFSET: i32 = 543;

// ช่วงปี พ.ศ. ที่ยอมรับ — ไว้ดักกรณีกรอกปี ค.ศ. มาโดยไม่ตั้งใจ
// (2026 จะถูกตีเป็น พ.ศ. แล้วกลายเป็น ค.ศ. 1483 แบบเงียบๆ)
pub const MIN_BUDDHIST_YEAR: i32 = 2400; // ค.ศ. 1857
pub const MAX_BUDDHIST_YEAR: i32 = 2700; // ค.ศ. 2157

pub const ROOT_PAYLOAD: &str = r#"{"message":"Hello Kitty"}"#;
