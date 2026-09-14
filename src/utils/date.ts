import dayjs, { type Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import utc from "dayjs/plugin/utc";
import { RegexConstants } from "../constants/regex";
import { CalendarConstants, TZConstants } from "../constants/tz";

dayjs.extend(utc);
dayjs.extend(customParseFormat);

// ---------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------
// วันที่ทุกตัวในระบบเก็บเป็น dayjs แบบ UTC-midnight เพื่อให้ diff เป็นจำนวนวัน
// เต็มเสมอ ไม่มีเศษเวลามาปน — ตัวเลขที่แสดงเป็น "วัน" ล้วนๆ อยู่แล้ว
const ISO_FORMAT = "YYYY-MM-DD";
const OFFSET_MS = TZConstants.TH_UTC_OFFSET_MINUTES * 60_000;

export type PlainDate = Dayjs;

// "YYYY-MM-DD" -> null ถ้าไม่ใช่วันที่ที่มีอยู่จริง (strict mode ปฏิเสธ 2026-02-31)
export const parseIsoDate = (input: string): PlainDate | null => {
  const parsed = dayjs.utc(input, ISO_FORMAT, true);
  return parsed.isValid() ? parsed : null;
};

// env ใช้ DD/MM/YYYY ปี พ.ศ. เช่น 01/03/2569 -> 2026-03-01
export const parseEnvDate = (input: string): PlainDate | null => {
  const matched = RegexConstants.DATE.exec(input);
  if (!matched) return null;

  const day = matched[1];
  const month = matched[2];
  const buddhistYear = Number(matched[3]);

  if (day === undefined || month === undefined) return null;
  if (!Number.isInteger(buddhistYear)) return null;

  // ดักกรณีกรอกปี ค.ศ. มา ไม่งั้น 2026 จะกลายเป็น ค.ศ. 1483 แบบเงียบๆ
  if (
    buddhistYear < CalendarConstants.MIN_BUDDHIST_YEAR ||
    buddhistYear > CalendarConstants.MAX_BUDDHIST_YEAR
  ) {
    return null;
  }

  const gregorianYear = buddhistYear - CalendarConstants.BUDDHIST_YEAR_OFFSET;
  return parseIsoDate(`${gregorianYear}-${month}-${day}`);
};

export const diffDays = (from: PlainDate, to: PlainDate): number =>
  to.diff(from, "day");

// จำนวนปี/เดือน/วันระหว่างสองวันที่ (ต้อง from <= to)
//
// ไม่ใช้ to.diff(from, "month") ตรงๆ เพราะ dayjs นับเดือนที่ถูก clamp เป็นเดือน
// เต็ม ทำให้เคสสิ้นเดือนเกินไปหนึ่งเดือน (1999-03-31 -> 2024-02-29 จะได้
// 24y11m0d แทนที่จะเป็น 24y10m29d) กฎที่ถูกคือตัดสินจำนวนเดือนเต็มโดยเทียบ
// ปลายทางกับ anchor ที่ยัง **ไม่ถูก clamp** แล้วค่อยให้ dayjs clamp ตอน add
export const diffYearsMonthsDays = (from: PlainDate, to: PlainDate) => {
  let months = (to.year() - from.year()) * 12 + (to.month() - from.month());

  const shifted = from.year() * 12 + from.month() + months;
  const anchorYear = Math.floor(shifted / 12);
  const anchorMonth = shifted % 12; // dayjs month() เป็น 0-based

  const reachedAnchor =
    to.year() > anchorYear ||
    (to.year() === anchorYear &&
      (to.month() > anchorMonth ||
        (to.month() === anchorMonth && to.date() >= from.date())));

  if (!reachedAnchor) months--;

  const anchor = from.add(months, "month");

  return {
    years: Math.trunc(months / 12),
    months: months % 12,
    days: diffDays(anchor, to),
  };
};

// วันครบรอบถัดไปแบบรายปี — dayjs .year() ร่น 29 ก.พ. เป็น 28 ก.พ. ให้เองในปีที่
// ไม่ใช่อธิกสุรทิน และคืน 29 ก.พ. ตามเดิมในปีอธิกสุรทิน จึงคิดใหม่ทีละปีได้เลย
export const nextYearlyOccurrence = (
  base: PlainDate,
  today: PlainDate,
): PlainDate => {
  const occurrence = (year: number) => base.year(year);

  const thisYear = occurrence(today.year());
  return today.isAfter(thisYear) ? occurrence(today.year() + 1) : thisYear;
};

// ---------------------------------------------------------------------------
// เวลาปัจจุบันตามเวลาไทย
// ---------------------------------------------------------------------------
// hot path: ถูกเรียกทุก request จึงใช้ utcOffset() แทน tz() (เร็วกว่า ~54 เท่า)
export const getToday = (): string =>
  dayjs().utcOffset(TZConstants.TH_UTC_OFFSET_MINUTES).format(ISO_FORMAT);

// เที่ยงคืนไทยถัดไปเป็น epoch ms — เรียกวันละครั้ง
export const nextMidnightMs = (): number => {
  const today = dayjs.utc(getToday(), ISO_FORMAT, true);
  return today.add(1, "day").valueOf() - OFFSET_MS;
};
