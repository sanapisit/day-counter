import { Config } from "../preload";
import {
  diffDays,
  diffYearsMonthsDays,
  nextYearlyOccurrence,
  parseEnvDate,
  parseIsoDate,
  type PlainDate,
} from "../utils/date";
import { Logs } from "../utils/log";

type Counter = {
  // เวลาที่ผ่านมาแล้ว เช่น "1y2m3d | 428d"
  passed: string;
  // จำนวนวันจนถึงรอบถัดไป เช่น "37d"
  countdownDays: string;
  countdownColor: string;
};

// บรรทัดหนึ่งในภาพ: tail (ถ้ามี) วาดต่อท้าย text ด้วย tailColor
export type Line = { text: string; tail?: string; tailColor?: string };

const TEXT_COLOR = "#fff";

// สีของจำนวนวัน countdown: วันนี้ = เขียว, อีก 1 วัน = เหลือง, อีก 2 วัน = ฟ้า
const countdownColor = (days: number): string =>
  ["#4ade80", "#facc15", "#38bdf8"][days] ?? TEXT_COLOR;

// วันที่ทุกตัวถูก validate ตั้งแต่ boot แล้ว (ดู preload/env.ts) ค่านี้จึงเป็น
// defence in depth ไม่ใช่ path ที่ควรเจอจริง
const INVALID: Counter = {
  passed: "Invalid date",
  countdownDays: "Invalid date",
  countdownColor: TEXT_COLOR,
};

// input เป็นสตริงดิบจาก env (DD/MM/YYYY ปี พ.ศ.) ส่วน today ถูกส่งมาจากผู้เรียก
// เพื่อให้ทุกบรรทัดในภาพเดียวกันอ้างอิงวันเดียวกัน
const calculate = (input: string, today: PlainDate | null): Counter => {
  const baseDate = parseEnvDate(input);
  if (!baseDate || !today) return INVALID;

  const isPast = !today.isBefore(baseDate);

  // ===== 1) เวลาที่ผ่านมา =====
  const elapsed = isPast
    ? diffYearsMonthsDays(baseDate, today)
    : diffYearsMonthsDays(today, baseDate);
  const totalDays = isPast ? diffDays(baseDate, today) : 0;

  // ===== 2) Countdown แบบวนรายปี =====
  const nextOccurrence = nextYearlyOccurrence(baseDate, today);
  const daysLeft = diffDays(today, nextOccurrence);

  return {
    passed: `${elapsed.years}y${elapsed.months}m${elapsed.days}d | ${totalDays}d`,
    countdownDays: `${daysLeft}d`,
    countdownColor: countdownColor(daysLeft),
  };
};

const countdownLine = (label: string, c: Counter): Line => ({
  text: `${label} - `,
  tail: c.countdownDays,
  tailColor: c.countdownColor,
});

const genLines = (todayStr: string): Line[] => {
  Logs.log("genText");

  const today = parseIsoDate(todayStr);

  const name1 = Config.PERSON_NAME_1;
  const name2 = Config.PERSON_NAME_2;
  const birthday1 = calculate(Config.PERSON_BIRTHDAY_1, today);
  const birthday2 = calculate(Config.PERSON_BIRTHDAY_2, today);
  const anniversary = calculate(Config.ANNIVERSARY, today);

  return [
    { text: `${name1} - ${birthday1.passed}` },
    { text: `${name2} - ${birthday2.passed}` },
    { text: `Anniversary - ${anniversary.passed}` },
    { text: "" },
    { text: "Countdown" },
    countdownLine(name1, birthday1),
    countdownLine(name2, birthday2),
    countdownLine("Anniversary", anniversary),
  ];
};

// ข้อความชุดเดียวใช้ได้กับทุกขนาดภาพของวันนั้น จึง cache แยกจาก canvas
let cachedLines: Line[] = [];
let cachedDate: string | null = null;

export const getTextLines = (today: string): Line[] => {
  if (cachedDate !== today) {
    cachedDate = today;
    cachedLines = genLines(today);
  }

  return cachedLines;
};
