use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Datelike, Months, NaiveDate, NaiveDateTime};

use crate::constants::{BUDDHIST_YEAR_OFFSET, MAX_BUDDHIST_YEAR, MIN_BUDDHIST_YEAR, TH_UTC_OFFSET_MS};

const DAY_MS: i64 = 86_400_000;

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

// เวลาไทยตอนนี้ (epoch ms ไม่มี leap second และไทยไม่มี DST จึงบวก offset ตรงๆ ได้)
pub fn local_at(now_ms: i64) -> NaiveDateTime {
    DateTime::from_timestamp_millis(now_ms + TH_UTC_OFFSET_MS)
        .unwrap_or_default()
        .naive_utc()
}

pub fn today() -> NaiveDate {
    local_at(now_ms()).date()
}

// เที่ยงคืนไทยถัดไปเป็น epoch ms
pub fn next_midnight_ms(now_ms: i64) -> i64 {
    let local = now_ms + TH_UTC_OFFSET_MS;
    (local.div_euclid(DAY_MS) + 1) * DAY_MS - TH_UTC_OFFSET_MS
}

// env ใช้ DD/MM/YYYY ปี พ.ศ. เช่น 01/03/2569 -> 2026-03-01
// None ถ้ารูปแบบผิด, วันที่ไม่มีอยู่จริง (31/02/2569) หรือปีหลุดช่วง พ.ศ.
pub fn parse_env_date(input: &str) -> Option<NaiveDate> {
    let parts: Vec<&str> = input.split('/').collect();
    let [d, m, y] = parts[..] else { return None };
    if d.len() != 2 || m.len() != 2 || y.len() != 4 || !input.bytes().all(|c| c.is_ascii_digit() || c == b'/') {
        return None;
    }

    let year: i32 = y.parse().ok()?;
    if !(MIN_BUDDHIST_YEAR..=MAX_BUDDHIST_YEAR).contains(&year) {
        return None;
    }

    NaiveDate::from_ymd_opt(year - BUDDHIST_YEAR_OFFSET, m.parse().ok()?, d.parse().ok()?)
}

pub fn diff_days(from: NaiveDate, to: NaiveDate) -> i64 {
    (to - from).num_days()
}

// จำนวนปี/เดือน/วันระหว่างสองวันที่ (ต้อง from <= to)
//
// จำนวนเดือนเต็มตัดสินจาก "วันที่ของเดือน" ก่อน clamp: ถ้า to.day < from.day
// เดือนสุดท้ายยังไม่ครบ แล้วค่อยให้ add months clamp วันสิ้นเดือนเอง
// (1999-03-31 -> 2024-02-29 = 24y10m29d ไม่ใช่ 24y11m0d)
pub fn diff_years_months_days(from: NaiveDate, to: NaiveDate) -> (i32, i32, i64) {
    let mut months = (to.year() - from.year()) * 12 + to.month() as i32 - from.month() as i32;
    if to.day() < from.day() {
        months -= 1;
    }

    let anchor = from + Months::new(months as u32);
    (months / 12, months % 12, diff_days(anchor, to))
}

// ย้ายไปปี y โดยร่น 29 ก.พ. เป็น 28 ก.พ. ในปีที่ไม่ใช่อธิกสุรทิน
fn with_year_clamped(date: NaiveDate, y: i32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, date.month(), date.day())
        .or_else(|| NaiveDate::from_ymd_opt(y, date.month(), date.day() - 1))
        .expect("only Feb 29 can be missing")
}

// วันครบรอบถัดไปแบบรายปี (วันนี้นับเป็นรอบนี้) — คิดใหม่ทีละปี 29 ก.พ. จึงไม่เพี้ยน
pub fn next_yearly_occurrence(base: NaiveDate, today: NaiveDate) -> NaiveDate {
    let this_year = with_year_clamped(base, today.year());
    if today > this_year { with_year_clamped(base, today.year() + 1) } else { this_year }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ymd(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn ms(iso: &str) -> i64 {
        DateTime::parse_from_rfc3339(iso).unwrap().timestamp_millis()
    }

    #[test]
    fn today_and_next_midnight_at_the_day_boundary() {
        // 23:59:59.999 / 00:00 ไทย = 16:59:59.999Z / 17:00Z
        let cases = [
            ("2026-09-25T16:59:59.999Z", ymd(2026, 9, 25), "2026-09-25T17:00:00Z"),
            ("2026-09-25T17:00:00.000Z", ymd(2026, 9, 26), "2026-09-26T17:00:00Z"),
            ("2028-02-28T17:00:00.000Z", ymd(2028, 2, 29), "2028-02-29T17:00:00Z"),
        ];
        for (now, day, midnight) in cases {
            assert_eq!(local_at(ms(now)).date(), day, "{now}");
            assert_eq!(next_midnight_ms(ms(now)), ms(midnight), "{now}");
        }
    }

    #[test]
    fn env_dates() {
        assert_eq!(parse_env_date("01/03/2569"), Some(ymd(2026, 3, 1)));
        assert_eq!(parse_env_date("31/02/2569"), None);
        assert_eq!(parse_env_date("01/03/2026"), None);
        assert_eq!(parse_env_date("1/03/2569"), None);
    }

    #[test]
    fn end_of_month_diff() {
        assert_eq!(diff_years_months_days(ymd(1999, 3, 31), ymd(2024, 2, 29)), (24, 10, 29));
        assert_eq!(diff_years_months_days(ymd(2024, 1, 31), ymd(2024, 2, 29)), (0, 0, 29));
        assert_eq!(diff_years_months_days(ymd(2000, 5, 15), ymd(2026, 5, 15)), (26, 0, 0));
    }

    #[test]
    fn feb_29_occurrence() {
        let base = ymd(1996, 2, 29);
        assert_eq!(next_yearly_occurrence(base, ymd(2026, 3, 1)), ymd(2027, 2, 28));
        assert_eq!(next_yearly_occurrence(base, ymd(2027, 3, 1)), ymd(2028, 2, 29));
        assert_eq!(next_yearly_occurrence(base, ymd(2028, 2, 29)), ymd(2028, 2, 29));
    }
}
