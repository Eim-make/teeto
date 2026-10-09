use image::imageops::{self, FilterType};
use image::{GrayImage, Luma, RgbaImage};

pub fn prepare(img: &RgbaImage) -> GrayImage {
    let gray = imageops::grayscale(img);
    let big = imageops::resize(&gray, gray.width() * 2, gray.height() * 2, FilterType::CatmullRom);
    GrayImage::from_fn(big.width(), big.height(), |x, y| {
        let v = big.get_pixel(x, y)[0];
        Luma([if v > 150 { 0 } else { 255 }])
    })
}

#[cfg(windows)]
pub fn read_text(img: &RgbaImage) -> Option<String> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let prepared = prepare(img);
    let (w, h) = (prepared.width(), prepared.height());
    let mut bgra = Vec::with_capacity((w * h * 4) as usize);
    for p in prepared.pixels() {
        bgra.extend_from_slice(&[p[0], p[0], p[0], 255]);
    }
    let writer = DataWriter::new().ok()?;
    writer.WriteBytes(&bgra).ok()?;
    let buffer = writer.DetachBuffer().ok()?;
    let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        w as i32,
        h as i32,
        BitmapAlphaMode::Premultiplied,
    )
    .ok()?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().ok()?;
    let result = engine.RecognizeAsync(&bitmap).ok()?.join().ok()?;
    let text = result.Text().ok()?.to_string();
    (!text.trim().is_empty()).then_some(text)
}

#[cfg(not(windows))]
pub fn read_text(_img: &RgbaImage) -> Option<String> {
    None
}

fn normalize(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

pub fn similarity(a: &str, b: &str) -> f32 {
    let (a, b): (Vec<char>, Vec<char>) = (normalize(a).chars().collect(), normalize(b).chars().collect());
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() {
            cur[j + 1] = (prev[j] + usize::from(ca != cb)).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    1.0 - prev[b.len()] as f32 / a.len().max(b.len()) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuzzy_matches_titles() {
        assert!(similarity("Infernal Soul", "Infernal Soul") > 0.99);
        assert!(similarity("lnfernal Sou1", "Infernal Soul") > 0.7);
        assert!(similarity("Infernal Soul", "Erosion") < 0.3);
        assert_eq!(similarity("", "x"), 0.0);
    }

    #[test]
    fn prepares_dark_text_on_light() {
        let img = RgbaImage::from_fn(4, 2, |x, _| if x < 2 { image::Rgba([250, 250, 250, 255]) } else { image::Rgba([10, 20, 30, 255]) });
        let out = prepare(&img);
        assert_eq!((out.width(), out.height()), (8, 4));
        assert_eq!(out.get_pixel(0, 0)[0], 0);
        assert_eq!(out.get_pixel(7, 0)[0], 255);
    }
}
