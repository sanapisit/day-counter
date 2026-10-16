// timestamp ผูกกับเวลาไทย (DD/MM/พ.ศ. HH:MM:SS) เสมอ ไม่ขึ้นกับ TZ ของ container
#[macro_export]
macro_rules! log {
    ($($arg:tt)*) => { $crate::log_line(format_args!($($arg)*)) };
}

mod cache;
mod constants;
mod date;
mod env;
mod render;

use std::{collections::HashMap, fmt, future::IntoFuture, process::exit};

use axum::{
    Router,
    extract::Query,
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use chrono::{Datelike, Timelike};

use constants::*;

pub fn log_line(args: fmt::Arguments) {
    let t = date::local_at(date::now_ms());
    println!(
        "{:02}/{:02}/{} {:02}:{:02}:{:02} [LOG] {args}",
        t.day(),
        t.month(),
        t.year() + BUDDHIST_YEAR_OFFSET,
        t.hour(),
        t.minute(),
        t.second()
    );
}

fn die(err: impl fmt::Display) -> ! {
    eprintln!("{err}");
    exit(1)
}

fn parse_size(q: &HashMap<String, String>) -> Option<(u32, u32)> {
    let cfg = env::config();
    let get = |key: &str, default: u32| q.get(key).map_or(Some(default.into()), |v| env::parse_int(v));
    let (w, h) = (get(QUERY_WIDTH, cfg.default_width)?, get(QUERY_HEIGHT, cfg.default_height)?);

    let valid = (MIN_WIDTH.into()..=MAX_WIDTH.into()).contains(&w) && (MIN_HEIGHT.into()..=MAX_HEIGHT.into()).contains(&h);
    valid.then_some((w as u32, h as u32))
}

async fn day_counter(q: &HashMap<String, String>) -> Result<Response, String> {
    let Some(size) = parse_size(q) else {
        return Ok((StatusCode::BAD_REQUEST, "Unsupported size").into_response());
    };

    let image = tokio::time::timeout(RENDER_TIMEOUT, cache::get_image(size))
        .await
        .map_err(|_| "Canvas generation timed out")??;

    // อย่าให้ cache ฝั่ง client ข้ามเที่ยงคืน ไม่งั้น widget จะค้างภาพของเมื่อวาน
    let now = date::now_ms();
    let seconds_left = (date::next_midnight_ms(now) - now + 999) / 1000;
    let max_age = IMAGE_MAX_AGE_SECONDS.min(seconds_left).max(1);

    let headers = [
        (header::CONTENT_TYPE, "image/webp".to_string()),
        (header::CACHE_CONTROL, format!("public, max-age={max_age}")),
    ];
    Ok((headers, image).into_response())
}

async fn route(path: &str, q: &HashMap<String, String>) -> Result<Response, String> {
    Ok(match path {
        "/" => ([(header::CONTENT_TYPE, "application/json")], ROOT_PAYLOAD).into_response(),
        "/health" => "ok".into_response(),
        "/day-counter" => day_counter(q).await?,
        _ => (StatusCode::NOT_FOUND, "Not Found").into_response(),
    })
}

async fn handle(uri: Uri, Query(q): Query<HashMap<String, String>>) -> Response {
    let target = uri.path_and_query().map_or("/", |pq| pq.as_str());
    log!("call {target}");

    route(uri.path(), &q).await.unwrap_or_else(|e| {
        log!("error {target}: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response()
    })
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = term.recv() => {},
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

// ใช้เป็น HEALTHCHECK ของ Docker: runtime image ไม่มี curl
fn health_check() -> i32 {
    use std::io::{Read, Write};

    let port = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000u16);
    let ok = (|| -> std::io::Result<bool> {
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port))?;
        stream.set_read_timeout(Some(std::time::Duration::from_secs(3)))?;
        stream.write_all(b"GET /health HTTP/1.0\r\n\r\n")?;
        let mut status = [0; 12];
        stream.read_exact(&mut status)?;
        Ok(status.ends_with(b"200"))
    })()
    .unwrap_or(false);

    if ok { 0 } else { 1 }
}

#[tokio::main]
async fn main() {
    if std::env::args().nth(1).as_deref() == Some("health") {
        exit(health_check());
    }

    log!("load Font");
    render::load_font().unwrap_or_else(|e| die(e));
    cache::init().unwrap_or_else(|e| die(e));
    let cfg = env::init().unwrap_or_else(|e| die(e));

    let listener = tokio::net::TcpListener::bind((cfg.host.as_str(), cfg.port)).await.unwrap_or_else(|e| die(e));
    log!("Running in {} on http://{}:{}", cfg.node_env, cfg.host, cfg.port);

    // อุ่น cache เบื้องหลัง: /health ต้องตอบได้ทันทีโดยไม่รอ render ภาพแรก
    tokio::spawn(cache::warmup());

    let app = Router::new().fallback(handle);
    let server = axum::serve(listener, app).with_graceful_shutdown(async {
        shutdown_signal().await;
        log!("Shutting down...");
    });

    // graceful shutdown รอ request ที่ค้างอยู่ — แต่ไม่เกิน SHUTDOWN_DRAIN
    tokio::select! {
        result = server.into_future() => result.unwrap_or_else(|e| die(e)),
        _ = async { shutdown_signal().await; tokio::time::sleep(SHUTDOWN_DRAIN).await } => {},
    }
}
