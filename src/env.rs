use std::{collections::HashMap, sync::OnceLock};

use chrono::NaiveDate;

use crate::{constants::*, date::parse_env_date};

pub struct Env {
    pub node_env: String,
    pub host: String,
    pub port: u16,

    pub font_size: f32,
    pub default_width: u32,
    pub default_height: u32,

    pub person_name_1: String,
    pub person_birthday_1: NaiveDate,
    pub person_name_2: String,
    pub person_birthday_2: NaiveDate,
    pub anniversary: NaiveDate,
}

static CONFIG: OnceLock<Env> = OnceLock::new();

pub fn config() -> &'static Env {
    CONFIG.get().expect("config loaded at boot")
}

const MAX_NAME_LENGTH: usize = 30;
const MAX_FONT_SIZE: i64 = 500;
const DATE_HINT: &str = "expected DD/MM/YYYY in Buddhist year, e.g. 01/03/2569";

// เลขจำนวนเต็มแบบ Number() ของ JS: "1179.0" ผ่าน, "1.5"/"abc"/"" ไม่ผ่าน
pub fn parse_int(s: &str) -> Option<i64> {
    let n: f64 = s.trim().parse().ok()?;
    (n.is_finite() && n.fract() == 0.0).then_some(n as i64)
}

fn require_int(name: &str, value: &str, min: i64, max: i64) -> Result<i64, String> {
    parse_int(value)
        .filter(|n| (min..=max).contains(n))
        .ok_or_else(|| format!("Invalid {name} (expected an integer in {min}-{max})"))
}

fn require_name(name: &str, value: String) -> Result<String, String> {
    if value.trim().is_empty() || value.encode_utf16().count() > MAX_NAME_LENGTH {
        return Err(format!("Invalid {name}"));
    }
    Ok(value)
}

// ดักวันที่ผิดตั้งแต่ boot แทนที่จะปล่อยไปโผล่บนภาพ
fn require_date(name: &str, value: &str) -> Result<NaiveDate, String> {
    parse_env_date(value).ok_or_else(|| format!("Invalid {name} ({DATE_HINT})"))
}

// .env ของโปรเจกต์ (Bun เคยโหลดให้อัตโนมัติ) — ค่าใน process env ชนะเสมอ
fn read_dotenv() -> HashMap<String, String> {
    let Ok(text) = std::fs::read_to_string(".env") else { return HashMap::new() };
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| {
            let v = v.trim();
            let v = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')).unwrap_or(v);
            (k.trim().trim_start_matches("export ").to_string(), v.to_string())
        })
        .collect()
}

pub fn init() -> Result<&'static Env, String> {
    let dotenv = read_dotenv();
    let get = |key: &str, default: &str| {
        std::env::var(key).ok().or_else(|| dotenv.get(key).cloned()).unwrap_or_else(|| default.to_string())
    };

    let node_env = get("NODE_ENV", "development");
    if !["development", "test", "production"].contains(&node_env.as_str()) {
        return Err("Invalid NODE_ENV".into());
    }
    let host = get("HOST", "0.0.0.0");
    if host.is_empty() {
        return Err("Invalid HOST".into());
    }

    let env = Env {
        node_env,
        host,
        port: require_int("PORT", &get("PORT", "3000"), 1, 65535)? as u16,

        font_size: require_int("FONT_SIZE", &get("FONT_SIZE", "48"), 1, MAX_FONT_SIZE)? as f32,
        // warmup render ขนาด default ตรงๆ โดยไม่ผ่าน parse_size จึงต้องดักตรงนี้
        default_width: require_int("DEFAULT_WIDTH", &get("DEFAULT_WIDTH", "1179"), MIN_WIDTH.into(), MAX_WIDTH.into())?
            as u32,
        default_height: require_int(
            "DEFAULT_HEIGHT",
            &get("DEFAULT_HEIGHT", "2556"),
            MIN_HEIGHT.into(),
            MAX_HEIGHT.into(),
        )? as u32,

        person_name_1: require_name("PERSON_NAME_1", get("PERSON_NAME_1", "Person1"))?,
        person_birthday_1: require_date("PERSON_BIRTHDAY_1", &get("PERSON_BIRTHDAY_1", "01/03/2569"))?,
        person_name_2: require_name("PERSON_NAME_2", get("PERSON_NAME_2", "Person2"))?,
        person_birthday_2: require_date("PERSON_BIRTHDAY_2", &get("PERSON_BIRTHDAY_2", "01/03/2569"))?,
        anniversary: require_date("ANNIVERSARY", &get("ANNIVERSARY", "01/03/2569"))?,
    };

    Ok(CONFIG.get_or_init(|| env))
}
