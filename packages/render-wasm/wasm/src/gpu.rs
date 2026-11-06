#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;

use effects::EffectPipeline;
use gpu::{GpuContext, wgpu};
use js_sys::{Object, Reflect};
use masks::MaskFeatherPipeline;
use serde::Deserialize;
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

pub(crate) struct GpuRuntime {
    pub(crate) context: GpuContext,
    pub(crate) effects: EffectPipeline,
    pub(crate) masks: MaskFeatherPipeline,
}

thread_local! {
    static GPU_RUNTIME: RefCell<Option<GpuRuntime>> = const { RefCell::new(None) };
}

fn set_panic_hook() {
    static SET_HOOK: std::sync::Once = std::sync::Once::new();
    SET_HOOK.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            // Store the full panic message in window.__wasmPanic so the JS catch block
            // can surface it instead of the opaque "Unreachable" WASM trap message.
            let _ = Reflect::set(&js_sys::global(), &JsValue::from_str("__wasmPanic"), &JsValue::from_str(&info.to_string()));
            console_error_panic_hook::hook(info);
        }));
    });
}

/// Initialises the GPU once and resolves to the backend name (`"webgpu"` or `"webgl2"`). A second call resolves to
/// the same name without creating a second device. `{forceBackend: "webgl2"}` skips WebGPU.
#[wasm_bindgen(js_name = initializeGpu)]
pub async fn initialize_gpu(options: JsValue) -> Result<JsValue, JsValue> {
    set_panic_hook();

    if let Some(name) = GPU_RUNTIME.with(|runtime| runtime.borrow().as_ref().map(|runtime| runtime.context.backend_name())) {
        return Ok(JsValue::from_str(name));
    }

    let force_gl = options
        .dyn_ref::<Object>()
        .and_then(|object| Reflect::get(object, &JsValue::from_str("forceBackend")).ok())
        .and_then(|value| value.as_string())
        .is_some_and(|backend| backend == "webgl2");
    let context = GpuContext::new_with(force_gl)
        .await
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let name = context.backend_name();
    let effects = EffectPipeline::new(&context);
    let masks = MaskFeatherPipeline::new(&context);

    GPU_RUNTIME.with(|runtime| {
        runtime.replace(Some(GpuRuntime {
            context,
            effects,
            masks,
        }));
    });

    Ok(JsValue::from_str(name))
}

/// Calls `callback(reason)` once when the device of the current runtime is lost (WebGPU; a lost WebGL context is
/// reported by the canvas itself).
#[wasm_bindgen(js_name = onDeviceLost)]
pub fn on_device_lost(callback: js_sys::Function) -> Result<(), JsValue> {
    with_gpu_runtime(|runtime| {
        let callback = send_wrapper(callback);
        runtime.context.device().set_device_lost_callback(move |_reason, message| {
            let _ = callback.0.call1(&JsValue::NULL, &JsValue::from_str(&message));
        });
        Ok(())
    })
}

/// A JS function carried into a callback that wgpu wants `Send`; the module runs on one thread.
struct SendFunction(js_sys::Function);
unsafe impl Send for SendFunction {}
unsafe impl Sync for SendFunction {}
fn send_wrapper(function: js_sys::Function) -> SendFunction {
    SendFunction(function)
}

/// Test hook: destroys the device, as a driver reset or a GPU process crash does.
#[wasm_bindgen(js_name = debugLoseDevice)]
pub fn debug_lose_device() -> Result<(), JsValue> {
    with_gpu_runtime(|runtime| {
        runtime.context.device().destroy();
        Ok(())
    })
}

/// Test hook: panics inside the module, as a defect in a render call does.
#[wasm_bindgen(js_name = debugPanic)]
pub fn debug_panic() {
    set_panic_hook();
    panic!("debug panic requested");
}

/// `{backend, software, maxTextureSize}` of the initialised device.
#[wasm_bindgen(js_name = getBackendInfo)]
pub fn get_backend_info() -> Result<JsValue, JsValue> {
    with_gpu_runtime(|runtime| {
        let info = Object::new();
        Reflect::set(&info, &"backend".into(), &JsValue::from_str(runtime.context.backend_name()))?;
        Reflect::set(&info, &"software".into(), &JsValue::from_bool(runtime.context.is_software()))?;
        Reflect::set(&info, &"maxTextureSize".into(), &JsValue::from_f64(f64::from(runtime.context.max_texture_size())))?;
        Ok(info.into())
    })
}

/// Drops the device and everything created on it.
pub(crate) fn drop_gpu_runtime() {
    GPU_RUNTIME.with(|runtime| {
        runtime.replace(None);
    });
}

pub(crate) fn with_gpu_runtime<T>(
    action: impl FnOnce(&GpuRuntime) -> Result<T, JsValue>,
) -> Result<T, JsValue> {
    GPU_RUNTIME.with(|runtime| {
        let borrow = runtime.borrow();
        let Some(gpu_runtime) = borrow.as_ref() else {
            return Err(JsValue::from_str(
                "GPU context not initialized. Call initializeGpu() first.",
            ));
        };
        action(gpu_runtime)
    })
}

pub(crate) fn import_canvas_texture(
    context: &GpuContext,
    canvas: &wgpu::web_sys::OffscreenCanvas,
    width: u32,
    height: u32,
    label: &'static str,
) -> wgpu::Texture {
    context.import_offscreen_canvas_texture(canvas, width, height, label)
}

pub(crate) fn render_texture_to_canvas(
    context: &GpuContext,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<wgpu::web_sys::OffscreenCanvas, JsValue> {
    let canvas = wgpu::web_sys::OffscreenCanvas::new(width, height)?;
    context
        .render_texture_to_offscreen_canvas(texture, &canvas, width, height)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(canvas)
}

pub(crate) fn read_property(object: &Object, name: &str) -> Result<JsValue, JsValue> {
    Reflect::get(object, &JsValue::from_str(name))
        .map_err(|_| JsValue::from_str(&format!("Missing property '{name}'")))
}

pub(crate) fn read_offscreen_canvas_property(
    object: &Object,
    name: &str,
) -> Result<wgpu::web_sys::OffscreenCanvas, JsValue> {
    read_property(object, name)?
        .dyn_into::<wgpu::web_sys::OffscreenCanvas>()
        .map_err(|_| JsValue::from_str(&format!("Property '{name}' must be an OffscreenCanvas")))
}

pub(crate) fn read_u32_property(object: &Object, name: &str) -> Result<u32, JsValue> {
    let value = read_property(object, name)?;
    let Some(number) = value.as_f64() else {
        return Err(JsValue::from_str(&format!(
            "Property '{name}' must be a number"
        )));
    };
    Ok(number as u32)
}

pub(crate) fn read_f32_property(object: &Object, name: &str) -> Result<f32, JsValue> {
    let value = read_property(object, name)?;
    let Some(number) = value.as_f64() else {
        return Err(JsValue::from_str(&format!(
            "Property '{name}' must be a number"
        )));
    };
    Ok(number as f32)
}

pub(crate) fn read_serde_property<T>(object: &Object, name: &str) -> Result<T, JsValue>
where
    T: for<'de> Deserialize<'de>,
{
    let value = read_property(object, name)?;
    serde_wasm_bindgen::from_value(value)
        .map_err(|error| JsValue::from_str(&format!("Invalid property '{name}': {error}")))
}
