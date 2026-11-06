#![cfg(target_arch = "wasm32")]

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use compositor::{Compositor, FrameDescriptor, FrameReport, RenderFrameOptions};
use gpu::wgpu;
use js_sys::{Array, Object, Reflect, Uint8Array};
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};
use wasm_bindgen_futures::JsFuture;

use crate::gpu::{drop_gpu_runtime, read_property, read_serde_property, read_u32_property, with_gpu_runtime};
use crate::perf;

struct CompositorRuntime {
    canvas: web_sys::HtmlCanvasElement,
    compositor: Compositor,
    surface: wgpu::Surface<'static>,
    surface_size: (u32, u32),
}

thread_local! {
    static COMPOSITOR_RUNTIME: RefCell<Option<CompositorRuntime>> = const { RefCell::new(None) };
}

/// Longest wait for the GPU to finish a frame or a read-back.
const WAIT_LIMIT_MS: f64 = 30_000.0;
const NOT_INITIALISED: &str = "Compositor is not initialized. Call initCompositor() first.";

fn with_compositor<T>(action: impl FnOnce(&crate::gpu::GpuRuntime, &mut CompositorRuntime) -> Result<T, JsValue>) -> Result<T, JsValue> {
    with_gpu_runtime(|gpu_runtime| {
        COMPOSITOR_RUNTIME.with(|runtime| {
            let mut borrow = runtime.borrow_mut();
            let Some(runtime) = borrow.as_mut() else {
                return Err(JsValue::from_str(NOT_INITIALISED));
            };
            action(gpu_runtime, runtime)
        })
    })
}

/// Refuses a texture size the device cannot hold, as an error the caller handles (the module never aborts on it).
fn check_texture_size(gpu_runtime: &crate::gpu::GpuRuntime, width: u32, height: u32) -> Result<(), JsValue> {
    let limit = gpu_runtime.context.max_texture_size();
    if width == 0 || height == 0 || width > limit || height > limit {
        return Err(JsValue::from_str(&format!("texture/size: {width}×{height} is outside 1…{limit}")));
    }
    Ok(())
}

fn object(value: JsValue, name: &str) -> Result<Object, JsValue> {
    value.dyn_into().map_err(|_| JsValue::from_str(&format!("{name} expects an options object")))
}

#[wasm_bindgen(js_name = initCompositor)]
pub fn init_compositor(options: JsValue) -> Result<(), JsValue> {
    let options = object(options, "initCompositor")?;
    let (width, height) = (read_u32_property(&options, "width")?, read_u32_property(&options, "height")?);
    with_gpu_runtime(|gpu_runtime| {
        // On WebGL, wgpu is bound to a specific canvas; reuse it so the UI
        // can mount the output directly instead of copying pixels through
        // an intermediate 2D canvas every frame. On WebGPU, surface rendering
        // works against any canvas so we create a fresh one.
        let canvas = if let Some(gl_canvas) = gpu_runtime.context.gl_canvas() {
            gl_canvas.clone()
        } else {
            gpu::GpuContext::create_canvas().ok_or_else(|| JsValue::from_str("Failed to create compositor canvas"))?
        };
        canvas.set_width(width);
        canvas.set_height(height);

        let compositor = Compositor::new(&gpu_runtime.context);
        let surface = gpu_runtime
            .context
            .instance()
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        gpu_runtime
            .context
            .configure_surface(&surface, width, height)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;

        COMPOSITOR_RUNTIME.with(|runtime| {
            runtime.replace(Some(CompositorRuntime { canvas, compositor, surface, surface_size: (width, height) }));
        });
        Ok(())
    })
}

/// Resizes the output and destroys every pooled render target of the old size.
#[wasm_bindgen(js_name = resizeCompositor)]
pub fn resize_compositor(options: JsValue) -> Result<(), JsValue> {
    let options = object(options, "resizeCompositor")?;
    let (width, height) = (read_u32_property(&options, "width")?, read_u32_property(&options, "height")?);
    with_compositor(|gpu_runtime, runtime| {
        if runtime.surface_size != (width, height) {
            runtime.canvas.set_width(width);
            runtime.canvas.set_height(height);
            gpu_runtime
                .context
                .configure_surface(&runtime.surface, width, height)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
            runtime.surface_size = (width, height);
            runtime.compositor.clear_pool();
        }
        Ok(())
    })
}

#[wasm_bindgen(js_name = getCompositorCanvas)]
pub fn get_compositor_canvas() -> Result<web_sys::HtmlCanvasElement, JsValue> {
    COMPOSITOR_RUNTIME.with(|runtime| {
        let borrow = runtime.borrow();
        let Some(runtime) = borrow.as_ref() else {
            return Err(JsValue::from_str(NOT_INITIALISED));
        };
        Ok(runtime.canvas.clone())
    })
}

/// Uploads a browser image source: an `OffscreenCanvas`, an `ImageBitmap` or an `HTMLCanvasElement`. The engine
/// turns a `VideoFrame` into an `ImageBitmap` (a GPU-side reference, not a pixel copy) before it calls this.
#[wasm_bindgen(js_name = uploadTexture)]
pub fn upload_texture(options: JsValue) -> Result<(), JsValue> {
    let options = object(options, "uploadTexture")?;
    let id: String = read_serde_property(&options, "id")?;
    let (width, height) = (read_u32_property(&options, "width")?, read_u32_property(&options, "height")?);
    let source = read_property(&options, "source")?;
    if let Some(canvas) = source.dyn_ref::<wgpu::web_sys::OffscreenCanvas>() {
        // WebGL cannot copy from an OffscreenCanvas directly; the engine hands it an ImageBitmap instead, and
        // this path stays for callers that pass the canvas itself.
        let canvas = canvas.clone();
        return with_compositor(|gpu_runtime, runtime| {
            check_texture_size(gpu_runtime, width, height)?;
            let texture = gpu_runtime.context.import_offscreen_canvas_texture(&canvas, width, height, "compositor-upload-texture");
            runtime.compositor.upsert_texture(id, texture);
            Ok(())
        });
    }
    let external = if let Some(bitmap) = source.dyn_ref::<wgpu::web_sys::ImageBitmap>() {
        wgpu::ExternalImageSource::ImageBitmap(bitmap.clone())
    } else if let Some(canvas) = source.dyn_ref::<wgpu::web_sys::HtmlCanvasElement>() {
        wgpu::ExternalImageSource::HTMLCanvasElement(canvas.clone())
    } else {
        return Err(JsValue::from_str("uploadTexture: source must be an OffscreenCanvas, an ImageBitmap or an HTMLCanvasElement"));
    };
    with_compositor(|gpu_runtime, runtime| {
        check_texture_size(gpu_runtime, width, height)?;
        // A texture of this id and size is written in place: the frames of a playing video create no texture.
        if let Some(existing) = runtime.compositor.reusable_texture(&id, width, height) {
            gpu_runtime.context.copy_external_into(&existing, external, width, height);
            return Ok(());
        }
        let texture = gpu_runtime.context.import_external_texture(external, width, height, "compositor-upload-texture");
        runtime.compositor.upsert_texture(id, texture);
        Ok(())
    })
}

/// Uploads straight RGBA8 pixels, top row first.
#[wasm_bindgen(js_name = uploadTexturePixels)]
pub fn upload_texture_pixels(options: JsValue) -> Result<(), JsValue> {
    let options = object(options, "uploadTexturePixels")?;
    let id: String = read_serde_property(&options, "id")?;
    let (width, height) = (read_u32_property(&options, "width")?, read_u32_property(&options, "height")?);
    let data = Uint8Array::new(&read_property(&options, "data")?).to_vec();
    if data.len() != (width as usize) * (height as usize) * 4 {
        return Err(JsValue::from_str("uploadTexturePixels: data must hold width × height × 4 bytes"));
    }
    with_compositor(|gpu_runtime, runtime| {
        check_texture_size(gpu_runtime, width, height)?;
        let texture = gpu_runtime.context.create_texture_from_rgba(&data, width, height, "compositor-pixel-texture");
        runtime.compositor.upsert_texture(id, texture);
        Ok(())
    })
}

#[wasm_bindgen(js_name = releaseTexture)]
pub fn release_texture(options: JsValue) -> Result<(), JsValue> {
    let options = object(options, "releaseTexture")?;
    let id: String = read_serde_property(&options, "id")?;
    with_compositor(|_, runtime| {
        runtime.compositor.release_texture(&id);
        Ok(())
    })
}

fn report_to_js(report: &FrameReport) -> Result<JsValue, JsValue> {
    let out = Object::new();
    let diagnostics = Array::new();
    for diagnostic in &report.diagnostics {
        let entry = Object::new();
        Reflect::set(&entry, &"id".into(), &JsValue::from_str(diagnostic.id))?;
        Reflect::set(&entry, &"subject".into(), &JsValue::from_str(&diagnostic.subject))?;
        diagnostics.push(&entry);
    }
    let stages = Array::new();
    for stage in &report.stages {
        stages.push(&JsValue::from_str(stage));
    }
    Reflect::set(&out, &"diagnostics".into(), &diagnostics)?;
    Reflect::set(&out, &"stages".into(), &stages)?;
    Reflect::set(&out, &"passes".into(), &JsValue::from_f64(f64::from(report.passes)))?;
    Ok(out.into())
}

/// Renders `{descriptor}` and presents it. A descriptor that is refused throws a string starting with
/// `descriptor/invalid` and leaves the previous frame on the surface.
#[wasm_bindgen(js_name = renderFrame)]
pub fn render_frame(options: JsValue) -> Result<JsValue, JsValue> {
    perf::reset();
    let options = object(options, "renderFrame")?;

    let t_deserialize = perf::now_ms();
    let frame: FrameDescriptor = serde_wasm_bindgen::from_value(read_property(&options, "descriptor")?)
        .map_err(|error| JsValue::from_str(&format!("descriptor/invalid: {error}")))?;
    frame.validate().map_err(|error| JsValue::from_str(&format!("descriptor/invalid: {error}")))?;
    perf::record("wasm.deserialize", perf::now_ms() - t_deserialize);

    with_compositor(|gpu_runtime, runtime| {
        let limit = gpu_runtime.context.max_texture_size();
        if frame.width > limit || frame.height > limit {
            return Err(JsValue::from_str(&format!("descriptor/invalid: {}×{} is larger than maxTextureSize {limit}", frame.width, frame.height)));
        }
        if runtime.surface_size != (frame.width, frame.height) {
            runtime.canvas.set_width(frame.width);
            runtime.canvas.set_height(frame.height);
            let t_surface = perf::now_ms();
            gpu_runtime
                .context
                .configure_surface(&runtime.surface, frame.width, frame.height)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
            perf::record("wasm.surfaceConfigure", perf::now_ms() - t_surface);
            runtime.surface_size = (frame.width, frame.height);
            runtime.compositor.clear_pool();
        }

        let report = if gpu_runtime.context.supports_surface_rendering() {
            let t_render = perf::now_ms();
            let result = runtime
                .compositor
                .render_frame(&gpu_runtime.context, RenderFrameOptions { frame: &frame, surface: &runtime.surface })
                .map_err(|error| JsValue::from_str(&error.to_string()));
            perf::record("wasm.renderFrameToSurface", perf::now_ms() - t_render);
            result?
        } else {
            // WebGL composites to a texture and then presents it.
            let t_composite = perf::now_ms();
            let (texture, report) = runtime
                .compositor
                .render_frame_to_texture(&gpu_runtime.context, &frame)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
            perf::record("wasm.compositeToTexture", perf::now_ms() - t_composite);

            let t_present = perf::now_ms();
            gpu_runtime
                .context
                .present_texture_to_surface(&texture, &runtime.surface)
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
            perf::record("wasm.presentToSurface", perf::now_ms() - t_present);
            report
        };
        perf::set_stages(&report.stages);
        report_to_js(&report)
    })
}

/// A JavaScript function handed to a wgpu callback. wasm here is single-threaded, so the value never leaves its thread.
struct OnThisThread(js_sys::Function);
// SAFETY: the module is built without threads; the callback runs on the thread that created the function.
unsafe impl Send for OnThisThread {}

/// A promise and the function that resolves it.
fn deferred() -> (js_sys::Promise, js_sys::Function) {
    let mut resolver = None;
    let promise = js_sys::Promise::new(&mut |resolve, _| resolver = Some(resolve));
    (promise, resolver.expect("the executor runs synchronously"))
}

/// Waits until `settled` resolves. WebGPU resolves it from its own callback; the WebGL backend completes work only
/// when the device is polled, so the device is polled every couple of milliseconds while waiting.
async fn settle(device: &wgpu::Device, settled: &js_sys::Promise, done: &Rc<Cell<bool>>, what: &str) -> Result<(), JsValue> {
    let started = perf::now_ms();
    loop {
        let _ = device.poll(wgpu::PollType::Poll);
        if done.get() {
            return Ok(());
        }
        let (timer, fire) = deferred();
        let global = js_sys::global();
        let set_timeout: js_sys::Function = Reflect::get(&global, &"setTimeout".into())?.unchecked_into();
        set_timeout.call2(&global, &fire, &JsValue::from_f64(2.0))?;
        JsFuture::from(js_sys::Promise::race(&Array::of2(settled, &timer))).await?;
        if !done.get() && perf::now_ms() - started > WAIT_LIMIT_MS {
            return Err(JsValue::from_str(&format!("{what}: the GPU did not report completion")));
        }
    }
}

/// Resolves when the GPU has finished the work submitted so far: the last frame is really drawn.
#[wasm_bindgen(js_name = frameDrawn)]
pub async fn frame_drawn() -> Result<(), JsValue> {
    let (device, queue) = with_gpu_runtime(|gpu_runtime| Ok((gpu_runtime.context.device().clone(), gpu_runtime.context.queue().clone())))?;
    let (settled, resolve) = deferred();
    let done = Rc::new(Cell::new(false));
    let on_done = OnThisThread(resolve);
    let flag = OnThisThreadFlag(done.clone());
    queue.on_submitted_work_done(move || {
        let (on_done, flag) = (&on_done, &flag);
        flag.0.set(true);
        let _ = on_done.0.call0(&JsValue::NULL);
    });
    settle(&device, &settled, &done, "frameDrawn").await
}

struct OnThisThreadFlag(Rc<Cell<bool>>);
// SAFETY: as for `OnThisThread`.
unsafe impl Send for OnThisThreadFlag {}

/// Reads RGBA8 pixels (straight alpha, top-left origin) of the last rendered frame.
#[wasm_bindgen(js_name = readPixels)]
pub async fn read_pixels(options: JsValue) -> Result<Uint8Array, JsValue> {
    let options = object(options, "readPixels")?;
    let (x, y) = (read_u32_property(&options, "x")?, read_u32_property(&options, "y")?);
    let (width, height) = (read_u32_property(&options, "width")?, read_u32_property(&options, "height")?);
    let (buffer, padded_row, bgra, device) = with_compositor(|gpu_runtime, runtime| {
        let Some(scene) = runtime.compositor.last_scene() else {
            return Err(JsValue::from_str("readPixels: no frame has been rendered"));
        };
        if width == 0 || height == 0 || x + width > scene.width() || y + height > scene.height() {
            return Err(JsValue::from_str("readPixels: the rectangle is outside the frame"));
        }
        let (buffer, padded_row) = gpu_runtime.context.begin_read(scene, x, y, width, height);
        let bgra = gpu_runtime.context.texture_format() == wgpu::TextureFormat::Bgra8Unorm;
        Ok((buffer, padded_row, bgra, gpu_runtime.context.device().clone()))
    })?;

    let (settled, resolve) = deferred();
    let done = Rc::new(Cell::new(false));
    let ok = Rc::new(Cell::new(false));
    let (on_done, flag, success) = (OnThisThread(resolve), OnThisThreadFlag(done.clone()), OnThisThreadFlag(ok.clone()));
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |result| {
        let (on_done, flag, success) = (&on_done, &flag, &success);
        success.0.set(result.is_ok());
        flag.0.set(true);
        let _ = on_done.0.call0(&JsValue::NULL);
    });
    settle(&device, &settled, &done, "readPixels").await?;
    if !ok.get() {
        return Err(JsValue::from_str("readPixels: the buffer could not be mapped"));
    }
    let mapped = buffer.slice(..).get_mapped_range();
    let mut pixels = Vec::with_capacity((width * height * 4) as usize);
    for row in 0..height as usize {
        let start = row * padded_row as usize;
        pixels.extend_from_slice(&mapped[start..start + (width * 4) as usize]);
    }
    drop(mapped);
    buffer.unmap();
    if bgra {
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
    }
    Ok(Uint8Array::from(&pixels[..]))
}

/// `{textures, textureBytes, poolBytes, poolCreated}`: uploaded textures and pooled render targets.
#[wasm_bindgen(js_name = getTextureStats)]
pub fn get_texture_stats() -> Result<JsValue, JsValue> {
    with_compositor(|_, runtime| {
        let (count, bytes, pool_bytes, created) = runtime.compositor.texture_stats();
        let out = Object::new();
        Reflect::set(&out, &"textures".into(), &JsValue::from_f64(count as f64))?;
        Reflect::set(&out, &"textureBytes".into(), &JsValue::from_f64(bytes as f64))?;
        Reflect::set(&out, &"poolBytes".into(), &JsValue::from_f64(pool_bytes as f64))?;
        Reflect::set(&out, &"poolCreated".into(), &JsValue::from_f64(created as f64))?;
        Ok(out.into())
    })
}

/// Ids of the shaders this build can run.
#[wasm_bindgen(js_name = listShaders)]
pub fn list_shaders() -> Result<Array, JsValue> {
    with_compositor(|_, runtime| Ok(runtime.compositor.shader_ids().iter().map(|id| JsValue::from_str(id)).collect()))
}

/// Releases every pooled render target (`memory.trim`).
#[wasm_bindgen(js_name = trimCompositor)]
pub fn trim_compositor() -> Result<(), JsValue> {
    with_compositor(|_, runtime| {
        runtime.compositor.clear_pool();
        Ok(())
    })
}

/// Drops the compositor, its textures and the GPU device.
#[wasm_bindgen]
pub fn destroy() {
    COMPOSITOR_RUNTIME.with(|runtime| {
        if let Some(mut runtime) = runtime.borrow_mut().take() {
            runtime.compositor.clear();
        }
    });
    drop_gpu_runtime();
}

/// The 17 blend mode ids in shader-code order: the one list the TypeScript side is compared with.
#[wasm_bindgen(js_name = listBlendModes)]
pub fn list_blend_modes() -> Array {
    color::BLEND_MODE_IDS.iter().map(|id| JsValue::from_str(id)).collect()
}
