use std::sync::OnceLock;

use chrono::NaiveDate;
use image::{ImageBuffer, Rgba, imageops::fast_blur};
use rustybuzz::{Face, UnicodeBuffer, ttf_parser};
use tiny_skia::{
    Color, FillRule, FilterQuality, GradientStop, IntRect, IntSize, LinearGradient, Mask, Paint, Path, PathBuilder,
    Pixmap, PixmapPaint, Point, Rect, SpreadMode, Stroke, Transform,
};

use crate::{
    constants::{FONT_PATH, WEBP_QUALITY},
    date::{diff_days, diff_years_months_days, next_yearly_occurrence},
    env::Env,
};

const LINE_HEIGHT_RATIO: f32 = 1.2;
const TEXT_COLOR: Color = Color::WHITE;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
static FACE: OnceLock<Face<'static>> = OnceLock::new();

pub fn load_font() -> Result<(), String> {
    let data = std::fs::read(FONT_PATH).map_err(|e| format!("{FONT_PATH}: {e}"))?;
    let face = Face::from_slice(Box::leak(data.into_boxed_slice()), 0).ok_or("invalid font")?;
    let _ = FACE.set(face);
    Ok(())
}

// รองรับทั้ง PNG และ JPEG (template.png ใน repo จริงๆ เป็น JPEG)
pub fn load_template(path: &str) -> Result<Pixmap, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    let rgba = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = rgba.dimensions();

    // tiny-skia เก็บสีแบบ premultiplied
    let mut data = rgba.into_raw();
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u16;
        for c in &mut px[..3] {
            *c = ((*c as u16 * a + 127) / 255) as u8;
        }
    }
    Pixmap::from_vec(data, IntSize::from_wh(w, h).ok_or("empty template")?).ok_or_else(|| "bad template".into())
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
// บรรทัดหนึ่งในภาพ: tail (ถ้ามี) วาดต่อท้าย text ด้วยสีของมันเอง
struct Line {
    text: String,
    tail: Option<(String, Color)>,
}

// สีของจำนวนวัน countdown: วันนี้ = เขียว, อีก 1 วัน = เหลือง, อีก 2 วัน = ฟ้า
fn countdown_color(days: i64) -> Color {
    match days {
        0 => Color::from_rgba8(0x4a, 0xde, 0x80, 255),
        1 => Color::from_rgba8(0xfa, 0xcc, 0x15, 255),
        2 => Color::from_rgba8(0x38, 0xbd, 0xf8, 255),
        _ => TEXT_COLOR,
    }
}

// (เวลาที่ผ่านมา เช่น "1y2m3d | 428d", จำนวนวันจนถึงรอบถัดไป)
fn calculate(base: NaiveDate, today: NaiveDate) -> (String, i64) {
    let is_past = today >= base;
    let (y, m, d) = if is_past { diff_years_months_days(base, today) } else { diff_years_months_days(today, base) };
    let total = if is_past { diff_days(base, today) } else { 0 };
    let days_left = diff_days(today, next_yearly_occurrence(base, today));

    (format!("{y}y{m}m{d}d | {total}d"), days_left)
}

fn text_lines(cfg: &Env, today: NaiveDate) -> Vec<Line> {
    let (passed1, left1) = calculate(cfg.person_birthday_1, today);
    let (passed2, left2) = calculate(cfg.person_birthday_2, today);
    let (passed3, left3) = calculate(cfg.anniversary, today);

    let plain = |text: String| Line { text, tail: None };
    let countdown = |label: &str, days: i64| Line {
        text: format!("{label} - "),
        tail: Some((format!("{days}d"), countdown_color(days))),
    };

    vec![
        plain(format!("{} - {passed1}", cfg.person_name_1)),
        plain(format!("{} - {passed2}", cfg.person_name_2)),
        plain(format!("Anniversary - {passed3}")),
        plain(String::new()),
        plain("Countdown".into()),
        countdown(&cfg.person_name_1, left1),
        countdown(&cfg.person_name_2, left2),
        countdown("Anniversary", left3),
    ]
}

struct Outline<'a> {
    pb: &'a mut PathBuilder,
    x: f32,
    y: f32,
    scale: f32,
}

impl ttf_parser::OutlineBuilder for Outline<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.pb.move_to(self.x + x * self.scale, self.y - y * self.scale);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.pb.line_to(self.x + x * self.scale, self.y - y * self.scale);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let s = self.scale;
        self.pb.quad_to(self.x + x1 * s, self.y - y1 * s, self.x + x * s, self.y - y * s);
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let s = self.scale;
        self.pb.cubic_to(
            self.x + x1 * s,
            self.y - y1 * s,
            self.x + x2 * s,
            self.y - y2 * s,
            self.x + x * s,
            self.y - y * s,
        );
    }
    fn close(&mut self) {
        self.pb.close();
    }
}

// shape ด้วย rustybuzz (ไทยต้องใช้ GSUB/GPOS วางสระ/วรรณยุกต์) แล้วคืน path ของทั้ง
// บรรทัดที่ baseline (x, y) พร้อมความกว้าง
fn text_path(text: &str, size: f32, x: f32, y: f32) -> (Option<Path>, f32) {
    let face = FACE.get().expect("font loaded at boot");
    let scale = size / face.units_per_em() as f32;

    let mut buf = UnicodeBuffer::new();
    buf.push_str(text);
    let shaped = rustybuzz::shape(face, &[], buf);

    let mut pb = PathBuilder::new();
    let mut pen = 0.0;
    for (info, pos) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
        let mut outline = Outline {
            pb: &mut pb,
            x: x + (pen + pos.x_offset as f32) * scale,
            y: y - pos.y_offset as f32 * scale,
            scale,
        };
        face.outline_glyph(ttf_parser::GlyphId(info.glyph_id as u16), &mut outline);
        pen += pos.x_advance as f32;
    }

    (pb.finish(), pen * scale)
}

fn measure(text: &str, size: f32) -> f32 {
    text_path(text, size, 0.0, 0.0).1
}

// textBaseline = "middle" แบบ Skia: กึ่งกลางระหว่างเส้น ascent กับ descent ของ font
// (descender เป็นค่าติดลบ ระยะจากกึ่งกลางลงไปถึง baseline จึงเป็น (asc + desc) / 2)
fn middle_to_baseline(size: f32) -> f32 {
    let face = FACE.get().expect("font loaded at boot");
    (face.ascender() as f32 + face.descender() as f32) / 2.0 * size / face.units_per_em() as f32
}

fn fill_text(px: &mut Pixmap, text: &str, size: f32, x: f32, y: f32, color: Color) -> f32 {
    let (path, width) = text_path(text, size, x, y);
    if let Some(path) = path {
        let mut paint = Paint::default();
        paint.set_color(color);
        px.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
    }
    width
}

// ---------------------------------------------------------------------------
// Liquid Glass panel
// ---------------------------------------------------------------------------
struct Panel {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
}

fn white(alpha: f32) -> Color {
    Color::from_rgba(1.0, 1.0, 1.0, alpha).unwrap()
}

fn vertical_gradient(p: &Panel, stops: Vec<GradientStop>) -> Paint<'static> {
    let mut paint = Paint::default();
    if let Some(shader) = LinearGradient::new(
        Point::from_xy(0.0, p.y),
        Point::from_xy(0.0, p.y + p.h),
        stops,
        SpreadMode::Pad,
        Transform::identity(),
    ) {
        paint.shader = shader;
    }
    paint
}

fn round_rect(p: &Panel) -> Option<Path> {
    let Panel { x, y, w, h, r } = *p;
    let k = 0.552_284_8 * r; // ระยะ control point ของ cubic ที่ประมาณวงกลม

    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    pb.close();
    pb.finish()
}

// เบลอเฉพาะส่วนพื้นหลังที่อยู่ใต้กรอบ (บวกระยะ bleed กันขอบเบลอโผล่) แล้วซ้อน
// tint บางๆ กับ sheen ด้านบน — ไม่เบลอทั้งภาพเพื่อลดต้นทุนบน Raspberry Pi
//
// ไม่มี drop shadow: ของเดิมใช้ shadowBlur กับ fill alpha 0.01 ซึ่ง Skia คูณ alpha
// ของเงาด้วย alpha ของ fill เงาจึงมองไม่เห็นอยู่แล้ว (~0.35%)
fn draw_backdrop(px: &mut Pixmap, p: &Panel, path: &Path) -> Option<()> {
    let blur = p.r.round();
    let bleed = blur * 2.0;
    let crop = IntRect::from_ltrb(
        (p.x - bleed).max(0.0).floor() as i32,
        (p.y - bleed).max(0.0).floor() as i32,
        (p.x + p.w + bleed).min(px.width() as f32).ceil() as i32,
        (p.y + p.h + bleed).min(px.height() as f32).ceil() as i32,
    )?;

    let region = px.clone_rect(crop)?;
    let buf = ImageBuffer::<Rgba<u8>, _>::from_raw(crop.width(), crop.height(), region.take())?;
    let blurred = Pixmap::from_vec(fast_blur(&buf, blur).into_raw(), crop.size())?;

    let mut clip = Mask::new(px.width(), px.height())?;
    clip.fill_path(path, FillRule::Winding, true, Transform::identity());

    px.draw_pixmap(crop.x(), crop.y(), blurred.as_ref(), &PixmapPaint::default(), Transform::identity(), Some(&clip));

    // milky tint (บางพอให้เบลอพื้นหลังยังโปร่งแสงอยู่) + top sheen
    let rect = Rect::from_xywh(p.x, p.y, p.w, p.h)?;
    let mut tint = Paint::default();
    tint.set_color(white(0.08));
    px.fill_rect(rect, &tint, Transform::identity(), Some(&clip));

    let sheen = vertical_gradient(
        p,
        vec![GradientStop::new(0.0, white(0.45)), GradientStop::new(0.35, white(0.08)), GradientStop::new(1.0, white(0.0))],
    );
    px.fill_rect(rect, &sheen, Transform::identity(), Some(&clip));
    Some(())
}

// ขอบใสบางแบบ hairline
fn draw_border(px: &mut Pixmap, p: &Panel, path: &Path) {
    let paint = vertical_gradient(p, vec![GradientStop::new(0.0, white(0.7)), GradientStop::new(1.0, white(0.18))]);
    let stroke = Stroke { width: (p.r * 0.06).max(1.0), ..Default::default() };
    px.stroke_path(path, &paint, &stroke, Transform::identity(), None);
}

fn draw_glass_panel(px: &mut Pixmap, p: &Panel) {
    if p.w <= 0.0 || p.h <= 0.0 {
        return;
    }
    let Some(path) = round_rect(p) else { return };
    draw_backdrop(px, p, &path);
    draw_border(px, p, &path);
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------
// วาด template แบบ cover: ขยายให้เต็มกรอบแล้ว center ส่วนที่เกินถูกตัดทิ้ง
fn draw_template_cover(px: &mut Pixmap, template: &Pixmap) {
    let (w, h) = (px.width() as f32, px.height() as f32);
    let (tw, th) = (template.width() as f32, template.height() as f32);
    let scale = (w / tw).max(h / th);

    let dw = (tw * scale).floor();
    let dh = (th * scale).floor();
    let ts = Transform::from_row(dw / tw, 0.0, 0.0, dh / th, ((w - dw) / 2.0).floor(), ((h - dh) / 2.0).floor());
    let paint = PixmapPaint { quality: FilterQuality::Bilinear, ..Default::default() };
    px.draw_pixmap(0, 0, template.as_ref(), &paint, ts, None);
}

// กรอบถูกกำหนดขนาดจากข้อความที่วัดได้ แล้ว clamp ไม่ให้ล้น canvas
// หมายเหตุ: ตัวข้อความเองไม่ถูกตัดหรือขึ้นบรรทัดใหม่ ชื่อที่ยาวเกินจะล้นกรอบ
fn layout_panel(w: f32, h: f32, font_size: f32, text_w: f32, text_h: f32) -> Panel {
    let pad_x = font_size * 1.1;
    let pad_y = font_size * 0.8;

    let x = w / 10.0;
    let y = (h / 2.0 - text_h / 2.0 - pad_y).max(0.0);
    let pw = (text_w + pad_x * 2.0).min(w - x);
    let ph = (text_h + pad_y * 2.0).min(h - y);

    Panel { x, y, w: pw, h: ph, r: (font_size * 0.9).min(pw / 2.0).min(ph / 2.0) }
}

// FONT_SIZE เป็นค่าสัมบูรณ์ ไม่ผูกกับ w/h ที่ร้องขอมา
pub fn render(w: u32, h: u32, today: NaiveDate, cfg: &Env, template: &Pixmap) -> Vec<u8> {
    crate::log!("genCanvas");

    let mut px = Pixmap::new(w, h).expect("size validated by caller");
    draw_template_cover(&mut px, template);

    let size = cfg.font_size;
    let lines = text_lines(cfg, today);
    let line_h = size * LINE_HEIGHT_RATIO;
    let text_h = lines.len() as f32 * line_h;
    let text_w = lines
        .iter()
        .map(|l| measure(&format!("{}{}", l.text, l.tail.as_ref().map_or("", |t| t.0.as_str())), size))
        .fold(0.0, f32::max);

    let (wf, hf) = (w as f32, h as f32);
    let panel = layout_panel(wf, hf, size, text_w, text_h);
    draw_glass_panel(&mut px, &panel);

    // ไม่มีเงาที่ตัวอักษร: กรอบกระจกให้ contrast พอสำหรับอ่านออกอยู่แล้ว
    let x = panel.x + size * 0.5; // ระยะห่างระหว่างข้อความกับขอบกรอบ
    let mut y = hf / 2.0 - text_h / 2.0 + line_h / 2.0 + middle_to_baseline(size);
    for line in &lines {
        let width = fill_text(&mut px, &line.text, size, x, y, TEXT_COLOR);
        if let Some((tail, color)) = &line.tail {
            fill_text(&mut px, tail, size, x + width, y, *color);
        }
        y += line_h;
    }

    let rgba = px.take_demultiplied();
    webp::Encoder::from_rgba(&rgba, w, h).encode(WEBP_QUALITY).to_vec()
}
