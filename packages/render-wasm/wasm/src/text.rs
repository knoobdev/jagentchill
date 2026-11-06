//! Text exports: font loading, layout and glyph outlines. They need no GPU and no DOM, so they also run in a
//! worker and in Node.

use std::cell::RefCell;

use js_sys::{Array, Reflect, Uint8Array};
use serde::Deserialize;
use text::{FontStore, TextStyle, layout_text as layout};
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

thread_local! {
    static FONTS: RefCell<FontStore> = RefCell::new(FontStore::default());
}

fn property(options: &JsValue, name: &str) -> Result<JsValue, JsValue> {
    Reflect::get(options, &JsValue::from_str(name))
}

fn string(options: &JsValue, name: &str) -> Result<String, JsValue> {
    property(options, name)?.as_string().ok_or_else(|| JsValue::from_str(&format!("'{name}' must be a string")))
}

/// Hands the bytes of a font to the shaper: `{id, data}`. Resolves `false` when they are not a readable font.
#[wasm_bindgen(js_name = loadFont)]
pub fn load_font(options: JsValue) -> Result<bool, JsValue> {
    let id = string(&options, "id")?;
    let data = Uint8Array::new(&property(&options, "data")?).to_vec();
    Ok(FONTS.with(|fonts| fonts.borrow_mut().load(&id, data)))
}

#[wasm_bindgen(js_name = hasFont)]
pub fn has_font(options: JsValue) -> Result<bool, JsValue> {
    let id = string(&options, "id")?;
    Ok(FONTS.with(|fonts| fonts.borrow().has(&id)))
}

#[wasm_bindgen(js_name = unloadFont)]
pub fn unload_font(options: JsValue) -> Result<(), JsValue> {
    let id = string(&options, "id")?;
    FONTS.with(|fonts| fonts.borrow_mut().remove(&id));
    Ok(())
}

/// Whether the `cmap` of font `{id}` covers every character of `{text}`.
#[wasm_bindgen(js_name = fontCovers)]
pub fn font_covers(options: JsValue) -> Result<bool, JsValue> {
    let (id, text) = (string(&options, "id")?, string(&options, "text")?);
    Ok(FONTS.with(|fonts| fonts.borrow().covers(&id, &text)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutOptions {
    style: TextStyle,
    content: String,
    #[serde(default)]
    max_width: Option<f32>,
}

/// `layoutText({style, content, maxWidth})`: lines of runs of positioned glyphs, every coordinate on a 1/64 px grid.
/// `undefined` when the first font of the style is not loaded.
#[wasm_bindgen(js_name = layoutText)]
pub fn layout_text(options: JsValue) -> Result<JsValue, JsValue> {
    let LayoutOptions { style, content, max_width } =
        serde_wasm_bindgen::from_value(options).map_err(|error| JsValue::from_str(&format!("layoutText: {error}")))?;
    let result = FONTS.with(|fonts| layout(&fonts.borrow(), &style, &content, max_width));
    match result {
        Some(result) => serde_wasm_bindgen::to_value(&result).map_err(|error| JsValue::from_str(&error.to_string())),
        None => Ok(JsValue::UNDEFINED),
    }
}

/// `glyphPaths({fontId, glyphIds})`: SVG path data per glyph, in em units with y pointing down; `""` for a glyph
/// without an outline (a space).
#[wasm_bindgen(js_name = glyphPaths)]
pub fn glyph_paths(options: JsValue) -> Result<Array, JsValue> {
    let font_id = string(&options, "fontId")?;
    let ids: Array = property(&options, "glyphIds")?.dyn_into().map_err(|_| JsValue::from_str("'glyphIds' must be an array"))?;
    let out = Array::new();
    FONTS.with(|fonts| {
        let fonts = fonts.borrow();
        for id in ids.iter() {
            let path = fonts.glyph_path(&font_id, id.as_f64().unwrap_or(0.0) as u16).unwrap_or_default();
            out.push(&JsValue::from_str(&path));
        }
    });
    Ok(out)
}

/// `glyphPaint({fontId, glyphId})`: the paint program of a colour glyph (`{unitsPerEm, ops}` in font units, y up), or
/// `undefined` for a glyph that is drawn from its outline.
#[wasm_bindgen(js_name = glyphPaint)]
pub fn glyph_paint(options: JsValue) -> Result<JsValue, JsValue> {
    let font_id = string(&options, "fontId")?;
    let glyph = property(&options, "glyphId")?.as_f64().unwrap_or(0.0) as u16;
    match FONTS.with(|fonts| fonts.borrow().glyph_paint(&font_id, glyph)) {
        Some(paint) => serde_wasm_bindgen::to_value(&paint).map_err(|error| JsValue::from_str(&error.to_string())),
        None => Ok(JsValue::UNDEFINED),
    }
}
