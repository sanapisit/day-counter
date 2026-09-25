import { afterAll, expect, setSystemTime, test } from "bun:test";
import dayjs from "dayjs";
import { TZConstants } from "../constants/tz";
import { getNextMidnightMs, getToday } from "./date";

afterAll(() => setSystemTime());

// 23:59:59.999 / 00:00 ไทย = 16:59:59.999Z / 17:00Z
const cases = [
  "2026-09-25T16:59:59.999Z",
  "2026-09-25T17:00:00.000Z",
  "2028-02-28T17:00:00.000Z", // เข้าสู่ 29 ก.พ.
  "2026-09-25T10:00:00.000Z", // นาฬิกาถอยหลังข้ามวัน (Pi ไม่มี RTC)
];

test("getToday / getNextMidnightMs match dayjs at the day boundary", () => {
  for (const iso of cases) {
    setSystemTime(new Date(iso));
    const local = dayjs().utcOffset(TZConstants.TH_UTC_OFFSET_MINUTES);

    expect(getToday()).toBe(local.format("YYYY-MM-DD"));
    expect(getNextMidnightMs()).toBe(
      local.startOf("day").add(1, "day").valueOf(),
    );
  }
});
