use image::imageops::{self, FilterType};
use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

const COARSE: usize = 4;
const FINE: usize = 12;
const SEARCH_WIDTH: u32 = 640;
const MIN_ICON: f32 = 0.05;
const MAX_ICON: f32 = 0.17;
const SIZE_STEP: f32 = 1.12;
const SHORTLIST: usize = 80;
pub const MATCH_THRESHOLD: f32 = 0.82;
const TIE: f32 = 0.015;

pub struct Template {
    pub id: i32,
    coarse: Vec<f32>,
    fine: Vec<f32>,
}

pub struct Library {
    templates: Vec<Template>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Slot {
    pub x: f32,
    pub y: f32,
    pub size: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Found {
    pub id: i32,
    pub slot: Slot,
    pub score: f32,
    #[serde(default)]
    pub alternatives: Vec<i32>,
}

struct Integral {
    width: usize,
    height: usize,
    sums: Vec<[f64; 3]>,
}

impl Integral {
    fn new(img: &RgbaImage) -> Self {
        let (w, h) = (img.width() as usize, img.height() as usize);
        let mut sums = vec![[0.0; 3]; (w + 1) * (h + 1)];
        for y in 0..h {
            let mut row = [0.0f64; 3];
            for x in 0..w {
                let p = img.get_pixel(x as u32, y as u32);
                for c in 0..3 {
                    row[c] += p[c] as f64;
                    sums[(y + 1) * (w + 1) + x + 1][c] = sums[y * (w + 1) + x + 1][c] + row[c];
                }
            }
        }
        Self { width: w, height: h, sums }
    }

    fn mean(&self, x0: f32, y0: f32, x1: f32, y1: f32) -> [f32; 3] {
        let clamp = |v: f32, max: usize| (v.round().max(0.0) as usize).min(max);
        let (x0, x1) = (clamp(x0, self.width), clamp(x1, self.width).max(clamp(x0, self.width) + 1).min(self.width));
        let (y0, y1) = (clamp(y0, self.height), clamp(y1, self.height).max(clamp(y0, self.height) + 1).min(self.height));
        let at = |x: usize, y: usize| self.sums[y * (self.width + 1) + x];
        let area = ((x1 - x0) * (y1 - y0)).max(1) as f64;
        let mut out = [0.0; 3];
        for (c, value) in out.iter_mut().enumerate() {
            let s = at(x1, y1)[c] - at(x0, y1)[c] - at(x1, y0)[c] + at(x0, y0)[c];
            *value = (s / area) as f32;
        }
        out
    }

    fn descriptor(&self, slot: Slot, grid: usize) -> Vec<f32> {
        let cell = slot.size / grid as f32;
        let mut d = Vec::with_capacity(grid * grid * 3);
        for gy in 0..grid {
            for gx in 0..grid {
                let x0 = slot.x + gx as f32 * cell;
                let y0 = slot.y + gy as f32 * cell;
                d.extend_from_slice(&self.mean(x0, y0, x0 + cell, y0 + cell));
            }
        }
        normalize(d)
    }
}

fn normalize(mut d: Vec<f32>) -> Vec<f32> {
    let mean = d.iter().sum::<f32>() / d.len() as f32;
    d.iter_mut().for_each(|v| *v -= mean);
    let norm = d.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 1e-3 {
        d.iter_mut().for_each(|v| *v /= norm);
    }
    d
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

pub fn flatten(icon: &RgbaImage) -> RgbaImage {
    let mut out = RgbaImage::from_pixel(icon.width(), icon.height(), Rgba([0, 0, 0, 255]));
    for (x, y, p) in icon.enumerate_pixels() {
        let a = p[3] as f32 / 255.0;
        out.put_pixel(x, y, Rgba([(p[0] as f32 * a) as u8, (p[1] as f32 * a) as u8, (p[2] as f32 * a) as u8, 255]));
    }
    out
}

impl Library {
    pub fn new(icons: Vec<(i32, RgbaImage)>) -> Self {
        let templates = icons
            .into_iter()
            .map(|(id, icon)| {
                let flat = flatten(&icon);
                let integral = Integral::new(&flat);
                let slot = Slot { x: 0.0, y: 0.0, size: flat.width().min(flat.height()) as f32 };
                Template { id, coarse: integral.descriptor(slot, COARSE), fine: integral.descriptor(slot, FINE) }
            })
            .collect();
        Self { templates }
    }

    pub fn len(&self) -> usize {
        self.templates.len()
    }

    fn best(&self, descriptor: &[f32], fine: bool) -> (i32, f32) {
        self.templates
            .iter()
            .map(|t| (t.id, dot(descriptor, if fine { &t.fine } else { &t.coarse })))
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap_or((0, -1.0))
    }

    pub fn identify(&self, capture: &RgbaImage, slots: &[Slot]) -> Vec<Found> {
        let integral = Integral::new(capture);
        slots
            .iter()
            .map(|slot| {
                let d = integral.descriptor(*slot, FINE);
                let scored: Vec<(i32, f32)> = self.templates.iter().map(|t| (t.id, dot(&d, &t.fine))).collect();
                let (id, score) = scored.iter().copied().max_by(|a, b| a.1.total_cmp(&b.1)).unwrap_or((0, -1.0));
                let alternatives = scored.iter().filter(|(_, s)| *s >= score - TIE).map(|(i, _)| *i).collect();
                Found { id, slot: *slot, score, alternatives }
            })
            .collect()
    }

    pub fn search(&self, capture: &RgbaImage) -> Vec<Found> {
        let scale = (SEARCH_WIDTH as f32 / capture.width() as f32).min(1.0);
        let small = imageops::resize(
            capture,
            (capture.width() as f32 * scale) as u32,
            (capture.height() as f32 * scale) as u32,
            FilterType::Triangle,
        );
        let integral = Integral::new(&small);
        let (w, h) = (small.width() as f32, small.height() as f32);

        let mut shortlist: Vec<(f32, Slot)> = Vec::new();
        let mut size = h * MIN_ICON;
        while size <= h * MAX_ICON {
            let stride = (size / 5.0).max(2.0);
            let mut y = h * 0.08;
            while y + size <= h * 0.9 {
                let mut x = w * 0.08;
                while x + size <= w * 0.92 {
                    let slot = Slot { x, y, size };
                    let (_, score) = self.best(&integral.descriptor(slot, COARSE), false);
                    shortlist.push((score, slot));
                    x += stride;
                }
                y += stride;
            }
            size *= SIZE_STEP;
        }
        shortlist.sort_by(|a, b| b.0.total_cmp(&a.0));
        shortlist.truncate(SHORTLIST);

        let mut refined: Vec<Found> = shortlist
            .iter()
            .map(|(_, slot)| refine(self, &integral, *slot))
            .filter(|f| f.score >= MATCH_THRESHOLD)
            .map(|f| Found {
                id: f.id,
                score: f.score,
                slot: Slot { x: f.slot.x / scale, y: f.slot.y / scale, size: f.slot.size / scale },
                alternatives: Vec::new(),
            })
            .collect();
        refined.sort_by(|a, b| b.score.total_cmp(&a.score));
        pick_row(refined)
    }
}

fn refine(lib: &Library, integral: &Integral, slot: Slot) -> Found {
    let mut best = Found { id: 0, slot, score: -1.0, alternatives: Vec::new() };
    let step = (slot.size / 10.0).max(1.0);
    for ds in [0.92f32, 1.0, 1.08] {
        let size = slot.size * ds;
        for dy in -2..=2 {
            for dx in -2..=2 {
                let s = Slot { x: slot.x + dx as f32 * step, y: slot.y + dy as f32 * step, size };
                let (id, score) = lib.best(&integral.descriptor(s, FINE), true);
                if score > best.score {
                    best = Found { id, slot: s, score, alternatives: Vec::new() };
                }
            }
        }
    }
    best
}

fn is_card_row(row: &[Found]) -> bool {
    let [a, b, c] = row else { return false };
    let size = (a.slot.size + b.slot.size + c.slot.size) / 3.0;
    let same_size = row.iter().all(|f| (f.slot.size / size - 1.0).abs() < 0.12);
    let same_line = row.iter().all(|f| (f.slot.y - a.slot.y).abs() < size * 0.15);
    let (g1, g2) = (b.slot.x - a.slot.x, c.slot.x - b.slot.x);
    let even = (g1 - g2).abs() < size * 0.25 && g1 > size * 1.5;
    same_size && same_line && even
}

fn pick_row(mut candidates: Vec<Found>) -> Vec<Found> {
    candidates.truncate(40);
    let mut best: Option<(f32, Vec<Found>)> = None;
    for i in 0..candidates.len() {
        for j in i + 1..candidates.len() {
            for k in j + 1..candidates.len() {
                let mut row = vec![candidates[i].clone(), candidates[j].clone(), candidates[k].clone()];
                row.sort_by(|a, b| a.slot.x.total_cmp(&b.slot.x));
                let distinct = row[0].id != row[1].id && row[1].id != row[2].id && row[0].id != row[2].id;
                if !distinct || !is_card_row(&row) {
                    continue;
                }
                let total: f32 = row.iter().map(|f| f.score).sum();
                if best.as_ref().is_none_or(|(t, _)| total > *t) {
                    best = Some((total, row));
                }
            }
        }
    }
    best.map(|(_, row)| row).unwrap_or_default()
}

pub struct Meta {
    pub name: String,
    pub rarity: String,
}

pub fn title_region(slot: &Slot, width: u32, height: u32) -> (u32, u32, u32, u32) {
    let cx = slot.x + slot.size / 2.0;
    let x0 = (cx - slot.size * 0.9).max(0.0) as u32;
    let x1 = ((cx + slot.size * 0.9) as u32).min(width);
    let y0 = ((slot.y + slot.size * 1.08).max(0.0) as u32).min(height);
    let y1 = ((slot.y + slot.size * 1.4) as u32).min(height);
    (x0, y0, x1.saturating_sub(x0), y1.saturating_sub(y0))
}

pub fn resolve(found: &mut [Found], meta: &std::collections::HashMap<i32, Meta>, titles: &[Option<String>]) {
    let ids: Vec<i32> = found.iter().map(|f| f.id).collect();
    for (i, card) in found.iter_mut().enumerate() {
        if card.alternatives.len() <= 1 {
            continue;
        }
        let others: Vec<&str> = ids
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .filter_map(|(_, id)| meta.get(id).map(|m| m.rarity.as_str()))
            .collect();
        let shared = (others.len() == 2 && others[0] == others[1]).then(|| others[0]);
        let title = titles.get(i).and_then(|t| t.as_deref());
        let score = |id: &i32| {
            let Some(m) = meta.get(id) else { return -1.0 };
            let text = title.map_or(0.0, |t| crate::ocr::similarity(t, &m.name));
            let rarity = if shared == Some(m.rarity.as_str()) { 0.25 } else { 0.0 };
            text + rarity
        };
        if let Some(best) = card.alternatives.iter().copied().max_by(|a, b| score(a).total_cmp(&score(b))) {
            card.id = best;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn icon(seed: u32) -> RgbaImage {
        let mut img = RgbaImage::new(64, 64);
        for (x, y, p) in img.enumerate_pixels_mut() {
            let v = (x / 8 * 37 + y / 8 * 91 + seed * 53) % 251;
            let w = (x / 16 * 13 + y / 16 * 29 + seed * 17) % 211;
            *p = Rgba([v as u8, w as u8, ((v + w + seed * 7) % 256) as u8, 255]);
        }
        img
    }

    fn screen(cards: &[(u32, u32, u32, u32)]) -> RgbaImage {
        let mut img = RgbaImage::from_fn(1920, 1080, |x, y| {
            let n = (x.wrapping_mul(2654435761) ^ y.wrapping_mul(40503)) % 40;
            Rgba([20 + n as u8, 22 + n as u8, 30 + n as u8, 255])
        });
        for &(seed, x, y, size) in cards {
            let scaled = imageops::resize(&icon(seed), size, size, FilterType::Triangle);
            imageops::overlay(&mut img, &scaled, x as i64, y as i64);
        }
        img
    }

    fn library() -> Library {
        Library::new((1..=60).map(|s| (1000 + s as i32, icon(s))).collect())
    }

    #[test]
    fn finds_three_offered_augments() {
        let lib = library();
        let capture = screen(&[(7, 560, 380, 130), (23, 895, 380, 130), (41, 1230, 380, 130)]);
        let found = lib.search(&capture);
        let ids: Vec<i32> = found.iter().map(|f| f.id).collect();
        assert_eq!(ids, vec![1007, 1023, 1041], "found {found:?}");
        assert!((found[1].slot.x - 895.0).abs() < 30.0);
        assert!((found[1].slot.size - 130.0).abs() < 30.0);
    }

    #[test]
    fn identifies_known_layout_quickly() {
        let lib = library();
        let capture = screen(&[(3, 600, 300, 120), (9, 900, 300, 120), (12, 1200, 300, 120)]);
        let slots = [600.0, 900.0, 1200.0].map(|x| Slot { x, y: 300.0, size: 120.0 });
        let ids: Vec<i32> = lib.identify(&capture, &slots).iter().map(|f| f.id).collect();
        assert_eq!(ids, vec![1003, 1009, 1012]);
    }

    #[test]
    fn ignores_matches_that_are_not_a_card_row() {
        let lib = library();
        let capture = screen(&[(7, 300, 200, 130), (23, 1000, 600, 90), (41, 1600, 380, 130)]);
        assert!(lib.search(&capture).is_empty());
    }

    #[test]
    #[ignore]
    fn real_capture() {
        let (Ok(png), Ok(dir)) = (std::env::var("TEETO_SCAN_PNG"), std::env::var("TEETO_ICON_DIR")) else { return };
        let icons = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| {
                let path = e.ok()?.path();
                let id = path.file_stem()?.to_str()?.parse().ok()?;
                Some((id, image::open(&path).ok()?.to_rgba8()))
            })
            .collect();
        let lib = Library::new(icons);
        let capture = image::open(png).unwrap().to_rgba8();
        let started = std::time::Instant::now();
        let row = lib.search(&capture);
        let found = lib.identify(&capture, &row.iter().map(|f| f.slot).collect::<Vec<_>>());
        let titles: Vec<Option<String>> = found
            .iter()
            .map(|f| {
                let (x, y, w, h) = title_region(&f.slot, capture.width(), capture.height());
                crate::ocr::read_text(&image::imageops::crop_imm(&capture, x, y, w, h).to_image())
            })
            .collect();
        println!("found {found:?} titles {titles:?} in {:?}", started.elapsed());
    }

    #[test]
    fn resolves_identical_icons_by_title_then_rarity() {
        let meta: std::collections::HashMap<i32, Meta> = [
            (1, ("Infernal Soul", "kSilver")),
            (2, ("Erosion", "kSilver")),
            (3, ("Transmute: Prismatic", "kGold")),
            (4, ("Transmute: Chaos", "kPrismatic")),
            (5, ("Witchful Thinking", "kSilver")),
        ]
        .into_iter()
        .map(|(id, (name, rarity))| (id, Meta { name: name.into(), rarity: rarity.into() }))
        .collect();
        let slot = Slot { x: 0.0, y: 0.0, size: 10.0 };
        let card = |id: i32, alternatives: Vec<i32>| Found { id, slot, score: 0.9, alternatives };
        let mut found = vec![card(2, vec![1, 2]), card(4, vec![3, 4]), card(5, vec![5])];
        resolve(&mut found, &meta, &[Some("Infernal Soul".into()), None, None]);
        assert_eq!(found[0].id, 1);
        assert_eq!(found[1].id, 4);
        let mut found = vec![card(1, vec![1]), card(4, vec![3, 4]), card(5, vec![5])];
        resolve(&mut found, &meta, &[None, Some("Transmute Prismatic".into()), None]);
        assert_eq!(found[1].id, 3);
    }

    #[test]
    fn empty_screen_finds_nothing() {
        let lib = library();
        assert!(lib.search(&screen(&[])).is_empty());
    }
}
