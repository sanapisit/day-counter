export const TZConstants = {
  TH: "Asia/Bangkok",

  // ไทยใช้ UTC+7 มาตั้งแต่ปี 1920 และไม่เคยมี DST จึง hardcode offset ได้
  // dayjs.tz() ช้ากว่า utcOffset() ~54 เท่า เพราะสร้าง Intl.DateTimeFormat ใหม่ทุกครั้ง
  TH_UTC_OFFSET_MINUTES: 7 * 60,
} as const;

export const LocaleConstants = {
  TH: "th-TH",
} as const;

export const CalendarConstants = {
  // พ.ศ. = ค.ศ. + 543
  BUDDHIST_YEAR_OFFSET: 543,

  // ช่วงปี พ.ศ. ที่ยอมรับ — ไว้ดักกรณีกรอกปี ค.ศ. มาโดยไม่ตั้งใจ
  // (2026 จะถูกตีเป็น พ.ศ. แล้วกลายเป็น ค.ศ. 1483 แบบเงียบๆ)
  MIN_BUDDHIST_YEAR: 2400, // ค.ศ. 1857
  MAX_BUDDHIST_YEAR: 2700, // ค.ศ. 2157
} as const;
