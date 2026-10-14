use crate::{
    protocol::{validate_rect, Rect},
    AppState,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use tauri::State;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

pub fn encode(image: &RgbaImage) -> Result<Capture, String> {
    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|e| format!("Codifica immagine non riuscita: {e}"))?;
    Ok(Capture {
        data_url: format!(
            "data:image/png;base64,{}",
            STANDARD.encode(buffer.into_inner())
        ),
        width: image.width(),
        height: image.height(),
    })
}

pub fn take(x: i32, y: i32) -> Result<RgbaImage, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let monitor =
            xcap::Monitor::from_point(x, y).map_err(|e| format!("Monitor non disponibile: {e}"))?;
        monitor.capture_image().map_err(|e| format!(
            "Cattura non riuscita: {e}. Su macOS autorizza Orbit in Privacy e sicurezza > Registrazione schermo, poi riavvia l'app."
        ))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (x, y);
        Err("La cattura desktop di questa demo supporta Windows e macOS. Usa la preview browser per provare la UI.".into())
    }
}

fn crop_image(image: &RgbaImage, rect: Rect) -> Result<RgbaImage, String> {
    validate_rect(rect, image.width(), image.height())?;
    let cropped =
        image::imageops::crop_imm(image, rect.x, rect.y, rect.width, rect.height).to_image();
    Ok(if cropped.width() > 1800 || cropped.height() > 1800 {
        DynamicImage::ImageRgba8(cropped)
            .resize(1800, 1800, image::imageops::FilterType::Triangle)
            .to_rgba8()
    } else {
        cropped
    })
}

#[tauri::command]
pub async fn crop_capture(state: State<'_, AppState>, rect: Rect) -> Result<Capture, String> {
    let image = {
        let mut slot = state
            .capture
            .lock()
            .map_err(|_| "Stato cattura non disponibile.")?;
        let source = slot
            .as_ref()
            .ok_or("Nessuna cattura disponibile. Avvia una nuova cattura.")?;
        validate_rect(rect, source.width(), source.height())?;
        slot.take().ok_or("Nessuna cattura disponibile.")?
    };
    tauri::async_runtime::spawn_blocking(move || encode(&crop_image(&image, rect)?))
        .await
        .map_err(|e| format!("Elaborazione cattura non riuscita: {e}"))?
}

#[tauri::command]
pub fn discard_capture(state: State<'_, AppState>) -> Result<(), String> {
    state
        .capture
        .lock()
        .map_err(|_| "Stato cattura non disponibile.")?
        .take();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_preserves_selected_pixels_without_enlarging() {
        let mut image = RgbaImage::from_pixel(100, 80, image::Rgba([10, 20, 30, 255]));
        image.put_pixel(20, 30, image::Rgba([255, 0, 0, 255]));
        let crop = crop_image(
            &image,
            Rect {
                x: 20,
                y: 30,
                width: 10,
                height: 15,
            },
        )
        .unwrap();
        assert_eq!(crop.dimensions(), (10, 15));
        assert_eq!(crop.get_pixel(0, 0), &image::Rgba([255, 0, 0, 255]));
        let encoded = encode(&crop).unwrap();
        let bytes = STANDARD
            .decode(
                encoded
                    .data_url
                    .trim_start_matches("data:image/png;base64,"),
            )
            .unwrap();
        assert_eq!(image::load_from_memory(&bytes).unwrap().to_rgba8(), crop);
    }

    #[test]
    fn large_crop_is_downscaled_with_aspect_ratio() {
        let image = RgbaImage::new(2400, 1200);
        let crop = crop_image(
            &image,
            Rect {
                x: 0,
                y: 0,
                width: 2400,
                height: 1200,
            },
        )
        .unwrap();
        assert_eq!(crop.dimensions(), (1800, 900));
    }
}
