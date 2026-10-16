use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime},
};

use axum::body::Bytes;
use chrono::NaiveDate;
use futures_util::{
    FutureExt,
    future::{BoxFuture, Shared},
};
use tiny_skia::Pixmap;
use tokio::sync::Semaphore;

use crate::{
    constants::{MAX_CACHED_IMAGES, MAX_CONCURRENT_RENDERS, ROLLOVER_GRACE_MS, TEMPLATE_PATH, TEMPLATE_POLL_INTERVAL},
    date, env, render,
};

type Size = (u32, u32);
pub type ImageFuture = Shared<BoxFuture<'static, Result<Bytes, String>>>;

struct State {
    // ภาพของ "วันนี้" แยกตามขนาด — เก็บเป็น future ที่แชร์ได้เพื่อให้ request ที่มา
    // พร้อมกันใช้ผลของ render เดียว; FIFO (ไม่ใช่ LRU) พอสำหรับกัน memory โต
    date: Option<NaiveDate>,
    images: Vec<(Size, ImageFuture)>,
    // ขนาดที่เคยถูกขอ — อยู่ข้ามวัน (ต่างจาก images) เพื่อใช้ pre-warm ตอนเที่ยงคืน
    hot: Vec<Size>,
}

static STATE: Mutex<State> = Mutex::new(State { date: None, images: Vec::new(), hot: Vec::new() });
static TEMPLATE: Mutex<Option<Arc<Pixmap>>> = Mutex::new(None);

// บน Pi ที่มี 2 CPU การปล่อยให้ทุกขนาด render พร้อมกันทำให้ทุกอันช้าลงพร้อมกัน
// จนชน timeout และยังทำให้ peak memory พุ่งเกิน mem_limit 256m
static RENDER_SLOTS: Semaphore = Semaphore::const_new(MAX_CONCURRENT_RENDERS);

fn load_template() -> Result<(), String> {
    log!("load Template");
    let template = render::load_template(TEMPLATE_PATH)?;
    *TEMPLATE.lock().unwrap() = Some(Arc::new(template));
    Ok(())
}

// โหลดตอน boot: ไม่มี template = boot ไม่ผ่าน
pub fn init() -> Result<(), String> {
    load_template()
}

pub fn get_image((w, h): Size) -> ImageFuture {
    let today = date::today();
    let mut st = STATE.lock().unwrap();

    if st.date != Some(today) {
        st.date = Some(today);
        st.images.clear();
    }

    // จำขนาดไว้ก่อน แม้จะ hit cache ก็ตาม เพื่อให้ pre-warm รู้ว่าต้องอุ่นอะไรบ้าง
    if !st.hot.contains(&(w, h)) {
        if st.hot.len() >= MAX_CACHED_IMAGES {
            st.hot.remove(0);
        }
        st.hot.push((w, h));
    }

    if let Some((_, cached)) = st.images.iter().find(|(size, _)| *size == (w, h)) {
        return cached.clone();
    }
    if st.images.len() >= MAX_CACHED_IMAGES {
        let _ = st.images.remove(0);
    }

    let template = TEMPLATE.lock().unwrap().clone().expect("template loaded at boot");

    // render ใน task ของมันเอง: request ที่ timeout หรือหลุดไปไม่ได้ยกเลิกงาน และ
    // entry ยังอยู่ใน cache ต่อ request ถัดไปจึงได้ผลลัพธ์เดิมไปเลย
    let task = tokio::spawn(async move {
        let _slot = RENDER_SLOTS.acquire().await.map_err(|e| e.to_string())?;
        let result = tokio::task::spawn_blocking(move || render::render(w, h, today, env::config(), &template))
            .await
            .map(Bytes::from)
            .map_err(|e| e.to_string());

        if result.is_err() {
            STATE.lock().unwrap().images.retain(|(size, _)| *size != (w, h));
        }
        result
    });

    let pending = async move { task.await.map_err(|e| e.to_string())? }.boxed().shared();
    st.images.push(((w, h), pending.clone()));
    pending
}

// ---------------------------------------------------------------------------
// Pre-warm
// ---------------------------------------------------------------------------
// อุ่น cache ทีละขนาด (ไม่ขนาน) — ให้ request จริงแทรกเข้ามาใช้ slot ได้
static WARMING: AtomicBool = AtomicBool::new(false);

fn warm_hot_sizes() {
    if WARMING.swap(true, Ordering::AcqRel) {
        return;
    }

    tokio::spawn(async {
        let sizes = STATE.lock().unwrap().hot.clone();
        for (w, h) in sizes {
            if let Err(e) = get_image((w, h)).await {
                log!("warm {w}x{h} failed: {e}");
            }
        }
        WARMING.store(false, Ordering::Release);
    });
}

// template เพิ่งเปลี่ยน: ของเดิมใช้ไม่ได้แล้ว รวมถึง entry ที่ยัง render ค้างอยู่
// แล้วอุ่นใหม่เบื้องหลัง จะได้ไม่ผลักภาระ render ไปให้ request แรกที่เข้ามา
fn clear_cache() {
    STATE.lock().unwrap().images.clear();
    log!("clear canvas cache");
    warm_hot_sizes();
}

fn template_stamp() -> Option<(SystemTime, u64)> {
    let meta = std::fs::metadata(TEMPLATE_PATH).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}

// ไฟล์ที่เขียนไม่เสร็จจะ decode ไม่ผ่าน → ใช้ของเดิมต่อ แล้วรอบที่เขียนเสร็จ mtime
// จะเปลี่ยนอีกครั้งจนถูกโหลดใหม่เอง
fn spawn_template_watch() {
    tokio::spawn(async {
        let mut last = template_stamp();
        loop {
            tokio::time::sleep(TEMPLATE_POLL_INTERVAL).await;
            let stamp = template_stamp();
            if stamp == last {
                continue;
            }
            last = stamp;

            log!("Template changed");
            match tokio::task::spawn_blocking(load_template).await {
                Ok(Ok(())) => clear_cache(),
                Ok(Err(e)) => log!("Template reload failed: {e}"),
                Err(e) => log!("Template reload failed: {e}"),
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Rollover: render ภาพของวันใหม่ล่วงหน้า ไม่ใช่รอให้ request แรกเป็นคนจ่าย
// ---------------------------------------------------------------------------
fn spawn_rollover() {
    tokio::spawn(async {
        loop {
            let now = date::now_ms();
            let delay = (date::next_midnight_ms(now) - now + ROLLOVER_GRACE_MS).max(1);
            log!("next rollover warm in {}s", (delay as f64 / 1000.0).round());

            tokio::time::sleep(Duration::from_millis(delay as u64)).await;
            log!("date rollover: warming cache");
            warm_hot_sizes();
        }
    });
}

// เรียกจาก main หลัง server ขึ้นแล้ว
pub async fn warmup() {
    spawn_template_watch();

    let cfg = env::config();
    match get_image((cfg.default_width, cfg.default_height)).await {
        Ok(_) => log!("warmup done"),
        Err(e) => log!("warmup failed: {e}"),
    }

    spawn_rollover();
}
