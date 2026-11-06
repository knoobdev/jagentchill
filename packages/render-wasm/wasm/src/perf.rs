#![cfg(target_arch = "wasm32")]

//! Per-frame profile buffer for the render pipeline.
//!
//! Sub-span timings are recorded into a thread-local during `renderFrame`
//! and drained by JS via `getLastFrameProfile()`.

use std::cell::RefCell;

use js_sys::{Array, Object, Reflect};
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

thread_local! {
    static LAST_FRAME_PROFILE: RefCell<Vec<(&'static str, f64)>> = const { RefCell::new(Vec::new()) };
    static LAST_FRAME_STAGES: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) };
}

/// `performance.now()` of whichever global the module runs in (a window or a worker).
pub(crate) fn now_ms() -> f64 {
    Reflect::get(&js_sys::global(), &JsValue::from_str("performance"))
        .ok()
        .and_then(|performance| {
            let now: js_sys::Function = Reflect::get(&performance, &JsValue::from_str("now")).ok()?.dyn_into().ok()?;
            now.call0(&performance).ok()?.as_f64()
        })
        .unwrap_or(0.0)
}

pub(crate) fn set_stages(stages: &[&'static str]) {
    LAST_FRAME_STAGES.with(|cell| *cell.borrow_mut() = stages.to_vec());
}

pub(crate) fn reset() {
    LAST_FRAME_PROFILE.with(|cell| cell.borrow_mut().clear());
    LAST_FRAME_STAGES.with(|cell| cell.borrow_mut().clear());
}

pub(crate) fn record(name: &'static str, duration_ms: f64) {
    LAST_FRAME_PROFILE.with(|cell| cell.borrow_mut().push((name, duration_ms)));
}

#[wasm_bindgen(js_name = getLastFrameProfile)]
pub fn get_last_frame_profile() -> Array {
    LAST_FRAME_PROFILE.with(|cell| {
        let entries = cell.borrow();
        let array = Array::new_with_length(entries.len() as u32);
        for (index, (name, duration_ms)) in entries.iter().enumerate() {
            let entry = Object::new();
            Reflect::set(&entry, &JsValue::from_str("name"), &JsValue::from_str(name))
                .expect("set name");
            Reflect::set(
                &entry,
                &JsValue::from_str("durationMs"),
                &JsValue::from_f64(*duration_ms),
            )
            .expect("set durationMs");
            array.set(index as u32, entry.into());
        }
        // The stages the frame executed, by name and in order, after the timed spans.
        LAST_FRAME_STAGES.with(|stages| {
            for stage in stages.borrow().iter() {
                let entry = Object::new();
                Reflect::set(&entry, &JsValue::from_str("stage"), &JsValue::from_str(stage)).expect("set stage");
                array.push(&entry);
            }
        });
        array
    })
}
