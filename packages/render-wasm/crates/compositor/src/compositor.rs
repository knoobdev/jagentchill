use std::collections::HashMap;

use effects::{ApplyEffectsOptions, EffectPass, EffectPipeline, LibraryKind, LibraryShader, UniformValue, library, library_shader};
use gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext, wgpu};
use masks::{ApplyMaskFeatherOptions, MaskFeatherPipeline};
use thiserror::Error;
use wgpu::util::DeviceExt;

use crate::{
    BlendMode,
    frame::{
        ColorChainDescriptor, EffectPassDescriptor, EffectUniformValueDescriptor, FrameDescriptor, FrameItemDescriptor, LayerDescriptor,
        LayerMaskDescriptor, LutDescriptor, MAX_MASKS, SceneEffectDescriptor, TransitionDescriptor,
    },
    texture_pool::TexturePool,
    texture_store::TextureStore,
};

/// Uniform names every library pass may carry besides its own: the engine's time inputs.
const ENGINE_UNIFORMS: [&str; 3] = ["u_time", "u_frame", "u_progress"];

/// The effect frame of a pass: the matrix canvas pixel → frame uv (two rows of three), or `None` for the canvas.
type Frame<'a> = Option<&'a [f32; 9]>;

const UNIFORM_FLOATS: usize = 64;
type Uniforms = [f32; UNIFORM_FLOATS];

pub struct RenderFrameOptions<'a, 'surface> {
    pub frame: &'a FrameDescriptor,
    pub surface: &'a wgpu::Surface<'surface>,
}

/// A recoverable problem met while rendering a frame; the engine turns it into a `diagnostic` event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameDiagnostic {
    pub id: &'static str,
    pub subject: String,
}

/// What a rendered frame reports besides its pixels.
#[derive(Debug, Clone, Default)]
pub struct FrameReport {
    pub diagnostics: Vec<FrameDiagnostic>,
    /// Stage names executed, in order, layer after layer.
    pub stages: Vec<&'static str>,
    pub passes: u32,
}

#[derive(Debug, Error)]
pub enum CompositorError {
    #[error("Texture '{texture_id}' is not available")]
    MissingTexture { texture_id: String },
    #[error("descriptor/invalid: {0}")]
    InvalidDescriptor(String),
    #[error("Failed to present frame: {0}")]
    Gpu(#[from] gpu::GpuError),
}

/// A full-screen fragment pass over a number of input textures and one block of uniforms.
struct Pass {
    pipeline: wgpu::RenderPipeline,
    uniform_group: Option<u32>,
}

pub struct Compositor {
    textures: TextureStore,
    texture_pool: TexturePool,
    effects: EffectPipeline,
    masks: MaskFeatherPipeline,
    uniform_layout: wgpu::BindGroupLayout,
    vertex: wgpu::ShaderModule,
    passes: HashMap<&'static str, Pass>,
    last_scene: Option<wgpu::Texture>,
    report: FrameReport,
    /// Feathered masks by `(mask texture id, feather bits, width, height)`, with the frame that used them last. A
    /// mask that does not change between frames is feathered once: the distance field costs five canvas-size
    /// textures and some twenty passes.
    feathered: HashMap<(String, u32, u32, u32), (wgpu::Texture, u64)>,
    frame_index: u64,
}

/// A feathered mask that no frame used for this many frames is dropped.
const FEATHER_IDLE_FRAMES: u64 = 30;
/// Feathered masks kept at once (each is one canvas-size texture).
const FEATHER_CACHE_LIMIT: usize = 8;

fn build_pass(
    context: &GpuContext,
    vertex: &wgpu::ShaderModule,
    uniform_layout: &wgpu::BindGroupLayout,
    label: &'static str,
    source: &str,
    texture_count: u32,
    with_uniforms: bool,
) -> Pass {
    let device = context.device();
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(label),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    let mut layouts: Vec<Option<&wgpu::BindGroupLayout>> =
        (0..texture_count).map(|_| Some(context.texture_sampler_bind_group_layout())).collect();
    if with_uniforms {
        layouts.push(Some(uniform_layout));
    }
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(label),
        bind_group_layouts: &layouts,
        immediate_size: 0,
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: vertex,
            entry_point: Some("vertex_main"),
            buffers: &[wgpu::VertexBufferLayout {
                array_stride: std::mem::size_of::<[f32; 2]>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &[wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x2,
                    offset: 0,
                    shader_location: 0,
                }],
            }],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("fragment_main"),
            targets: &[Some(wgpu::ColorTargetState {
                format: context.texture_format(),
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    });
    Pass { pipeline, uniform_group: with_uniforms.then_some(texture_count) }
}

fn uniforms(values: &[f32]) -> Uniforms {
    let mut out = [0.0; UNIFORM_FLOATS];
    out[..values.len()].copy_from_slice(values);
    out
}

fn uniform_number(map: &HashMap<String, EffectUniformValueDescriptor>, name: &str, fallback: f32) -> f32 {
    match map.get(name) {
        Some(EffectUniformValueDescriptor::Number(value)) => *value,
        Some(EffectUniformValueDescriptor::Vector(values)) if !values.is_empty() => values[0],
        _ => fallback,
    }
}

/// The pass list of a Gaussian of `sigma` px, as `gaussianBlurPasses` of the engine builds it.
fn gaussian_passes(sigma: f32) -> Vec<EffectPassDescriptor> {
    if !(sigma >= 0.001) {
        return Vec::new();
    }
    let iterations = ((sigma * sigma / 1600.0).ceil() as usize).clamp(1, 8);
    let per_pass = sigma / (iterations as f32).sqrt();
    let step = (per_pass / 10.0).max(1.0);
    let mut passes = Vec::new();
    for _ in 0..iterations {
        for direction in [[1.0, 0.0], [0.0, 1.0]] {
            passes.push(EffectPassDescriptor {
                shader: "gaussian-blur".to_string(),
                uniforms: HashMap::from([
                    ("u_sigma".to_string(), EffectUniformValueDescriptor::Number(per_pass)),
                    ("u_step".to_string(), EffectUniformValueDescriptor::Number(step)),
                    ("u_direction".to_string(), EffectUniformValueDescriptor::Vector(direction.to_vec())),
                ]),
                textures: None,
                store: None,
            });
        }
    }
    passes
}

impl Compositor {
    pub fn new(context: &GpuContext) -> Self {
        let device = context.device();
        let vertex = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compositor-fullscreen-shader"),
            source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
        });
        let uniform_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("compositor-uniform-layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let mut passes = HashMap::new();
        let sources: [(&'static str, &str, u32, bool); 7] = [
            ("color-chain", include_str!("shaders/color_chain.wgsl"), 3, true),
            ("layer", include_str!("shaders/layer.wgsl"), 1, true),
            ("chroma-key", include_str!("shaders/chroma_key.wgsl"), 1, true),
            ("mask-combine", include_str!("shaders/mask_combine.wgsl"), 2, true),
            ("mask-apply", include_str!("shaders/mask.wgsl"), 2, false),
            ("blend", include_str!("shaders/blend.wgsl"), 2, true),
            ("scene-mix", include_str!("shaders/scene_mix.wgsl"), 3, true),
        ];
        for (id, source, texture_count, with_uniforms) in sources {
            passes.insert(id, build_pass(context, &vertex, &uniform_layout, id, source, texture_count, with_uniforms));
        }

        Self {
            textures: TextureStore::default(),
            texture_pool: TexturePool::default(),
            effects: EffectPipeline::new(context),
            masks: MaskFeatherPipeline::new(context),
            uniform_layout,
            vertex,
            passes,
            last_scene: None,
            feathered: HashMap::new(),
            frame_index: 0,
            report: FrameReport::default(),
        }
    }

    /// The stored texture of an id when it has exactly this size: a changing source (a video frame) is copied into
    /// it instead of replacing it, so playback creates no texture per frame.
    pub fn reusable_texture(&mut self, id: &str, width: u32, height: u32) -> Option<wgpu::Texture> {
        let texture = self.textures.get(id).map(|stored| stored.texture().clone()).filter(|texture| texture.width() == width && texture.height() == height)?;
        self.feathered.retain(|key, _| key.0 != id);
        Some(texture)
    }

    pub fn upsert_texture(&mut self, id: String, texture: wgpu::Texture) {
        self.feathered.retain(|key, _| key.0 != id);
        self.textures.upsert(id, texture);
    }

    pub fn release_texture(&mut self, id: &str) {
        self.feathered.retain(|key, _| key.0 != id);
        self.textures.remove(id);
    }

    /// Releases every uploaded texture and every pooled render target.
    pub fn clear(&mut self) {
        self.textures.clear();
        self.clear_pool();
    }

    /// Destroys the pooled render targets: on resize, on `memory.trim` and on device loss.
    pub fn clear_pool(&mut self) {
        self.texture_pool.clear();
        self.feathered.clear();
        self.last_scene = None;
    }

    /// `(uploaded texture count, uploaded bytes, pool bytes, pool textures created)`.
    pub fn texture_stats(&self) -> (usize, u64, u64, u64) {
        (self.textures.len(), self.textures.bytes(), self.texture_pool.bytes(), self.texture_pool.created())
    }

    /// The scene texture of the last rendered frame, for read-back.
    pub fn last_scene(&self) -> Option<&wgpu::Texture> {
        self.last_scene.as_ref()
    }

    /// Ids of every shader the compositor can run: its own stages, the effect shaders and the transitions.
    pub fn shader_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.passes.keys().map(|id| (*id).to_string()).collect();
        ids.extend(self.effects.shader_ids());
        ids.extend(library().iter().map(|shader| shader.id.clone()));
        // The Gaussian blur effect of the catalogue runs as `gaussian-blur` passes.
        ids.push("blur".to_string());
        ids.sort();
        ids.dedup();
        ids
    }

    /// Composites all frame items into a texture and returns it with the frame report.
    pub fn render_frame_to_texture(
        &mut self,
        context: &GpuContext,
        frame: &FrameDescriptor,
    ) -> Result<(wgpu::Texture, FrameReport), CompositorError> {
        frame.validate().map_err(CompositorError::InvalidDescriptor)?;
        self.check_textures(&frame.items, &mut Vec::new())?;
        self.texture_pool.recycle_frame();
        self.report = FrameReport::default();
        self.frame_index += 1;
        let frame_index = self.frame_index;
        self.feathered.retain(|_, entry| frame_index - entry.1 <= FEATHER_IDLE_FRAMES);
        let mut encoder = context.device().create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("compositor-frame-encoder"),
        });
        let scene = self.render_items(context, &mut encoder, &frame.items, frame.width, frame.height, frame.clear.color)?;
        context.queue().submit([encoder.finish()]);
        self.last_scene = Some(scene.clone());
        Ok((scene, std::mem::take(&mut self.report)))
    }

    /// Composites the frame and presents it on the surface. Nothing is presented when the descriptor is refused,
    /// so the surface keeps the previous frame.
    pub fn render_frame(
        &mut self,
        context: &GpuContext,
        options: RenderFrameOptions<'_, '_>,
    ) -> Result<FrameReport, CompositorError> {
        let frame = options.frame;
        frame.validate().map_err(CompositorError::InvalidDescriptor)?;
        self.check_textures(&frame.items, &mut Vec::new())?;
        self.texture_pool.recycle_frame();
        self.report = FrameReport::default();
        let surface_texture = context.acquire_surface_texture(options.surface)?;
        let surface_view = surface_texture.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = context.device().create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("compositor-frame-encoder"),
        });
        let scene = self.render_items(context, &mut encoder, &frame.items, frame.width, frame.height, frame.clear.color)?;
        context.encode_texture_blit_to_view(&mut encoder, &scene, &surface_view, "compositor-present-pass");
        context.queue().submit([encoder.finish()]);
        surface_texture.present();
        self.last_scene = Some(scene);
        Ok(std::mem::take(&mut self.report))
    }

    /// Every texture a descriptor names exists, counting the targets its own groups produce before their use.
    fn check_textures(&self, items: &[FrameItemDescriptor], produced: &mut Vec<String>) -> Result<(), CompositorError> {
        let known = |id: &str, produced: &Vec<String>| -> Result<(), CompositorError> {
            if self.textures.get(id).is_some() || produced.iter().any(|made| made == id) {
                Ok(())
            } else {
                Err(CompositorError::MissingTexture { texture_id: id.to_string() })
            }
        };
        let chain = |color: &ColorChainDescriptor, produced: &Vec<String>| -> Result<(), CompositorError> {
            color.lut.as_ref().map_or(Ok(()), |lut| known(&lut.texture_id, produced))?;
            color.curves_texture_id.as_ref().map_or(Ok(()), |id| known(id, produced))
        };
        let layer = |layer: &LayerDescriptor, produced: &Vec<String>| -> Result<(), CompositorError> {
            known(&layer.texture_id, produced)?;
            layer.masks.iter().try_for_each(|mask| known(&mask.texture_id, produced))?;
            layer.filter.as_ref().map_or(Ok(()), |lut| known(&lut.texture_id, produced))?;
            layer.person_matte.as_ref().map_or(Ok(()), |matte| known(&matte.texture_id, produced))?;
            layer.color.as_ref().map_or(Ok(()), |color| chain(color, produced))
        };
        for item in items {
            match item {
                FrameItemDescriptor::Layer(descriptor) => layer(descriptor, produced)?,
                FrameItemDescriptor::Transition(transition) => {
                    for background in [&transition.from_background, &transition.to_background].into_iter().flatten() {
                        self.check_textures(background, produced)?;
                    }
                    layer(&transition.from, produced)?;
                    layer(&transition.to, produced)?;
                }
                FrameItemDescriptor::SceneEffect(effect) => {
                    effect.masks.iter().try_for_each(|mask| known(&mask.texture_id, produced))?;
                    effect.filter.as_ref().map_or(Ok(()), |lut| known(&lut.texture_id, produced))?;
                    effect.color.as_ref().map_or(Ok(()), |color| chain(color, produced))?;
                }
                FrameItemDescriptor::Group(group) => {
                    self.check_textures(&group.items, produced)?;
                    produced.push(group.target_texture_id.clone());
                }
            }
        }
        Ok(())
    }

    fn render_items(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        items: &[FrameItemDescriptor],
        width: u32,
        height: u32,
        clear: [f32; 4],
    ) -> Result<wgpu::Texture, CompositorError> {
        let mut scene = self.cleared(context, encoder, width, height, clear);
        for item in items {
            match item {
                FrameItemDescriptor::Layer(layer) => {
                    let texture = self.render_layer(context, encoder, layer, width, height)?;
                    let mode = self.blend_mode(&layer.blend_mode);
                    self.report.stages.extend(["opacity", "blend"]);
                    scene = self.blend(context, encoder, &scene, &texture, mode, layer.opacity, width, height);
                }
                FrameItemDescriptor::Transition(transition) => {
                    scene = self.render_transition(context, encoder, &scene, transition, width, height)?;
                }
                FrameItemDescriptor::SceneEffect(effect) => {
                    scene = self.render_scene_effect(context, encoder, &scene, effect, width, height)?;
                }
                FrameItemDescriptor::Group(group) => {
                    let target = self.render_items(context, encoder, &group.items, width, height, [0.0; 4])?;
                    self.textures.upsert(group.target_texture_id.clone(), target);
                }
            }
        }
        Ok(scene)
    }

    fn blend_mode(&mut self, id: &str) -> BlendMode {
        BlendMode::from_id(id).unwrap_or_else(|| {
            self.diagnose("blend/unknown", id);
            BlendMode::NORMAL
        })
    }

    fn diagnose(&mut self, id: &'static str, subject: &str) {
        let entry = FrameDiagnostic { id, subject: subject.to_string() };
        if !self.report.diagnostics.contains(&entry) {
            self.report.diagnostics.push(entry);
        }
    }

    /// The per-layer stage chain up to, and not including, `opacity` and `blend`.
    fn render_layer(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        layer: &LayerDescriptor,
        width: u32,
        height: u32,
    ) -> Result<wgpu::Texture, CompositorError> {
        let source = self
            .textures
            .get(&layer.texture_id)
            .ok_or_else(|| CompositorError::MissingTexture { texture_id: layer.texture_id.clone() })?
            .texture()
            .clone();
        let (t, crop) = (&layer.transform, &layer.crop);
        let cropped = crop.left != 0.0 || crop.top != 0.0 || crop.right != 0.0 || crop.bottom != 0.0;
        self.report.stages.push("source");
        if cropped {
            self.report.stages.push("crop");
        }
        if t.flip_x || t.flip_y {
            self.report.stages.push("flip");
        }
        self.report.stages.push("transform");
        let mut current = self.run(context, encoder, "layer", &[&source], Some(uniforms(&[
            width as f32, height as f32, t.center_x, t.center_y,
            t.width, t.height, t.rotation_degrees.to_radians(), 0.0,
            crop.left, crop.top, crop.right, crop.bottom,
            if t.flip_x { 1.0 } else { 0.0 }, if t.flip_y { 1.0 } else { 0.0 },
        ])), width, height);

        if let Some(blend) = &layer.blend_source {
            // Smooth slow motion: the next source frame goes through the same crop, flip and transform and is mixed in.
            let next = self
                .textures
                .get(&blend.texture_id)
                .ok_or_else(|| CompositorError::MissingTexture { texture_id: blend.texture_id.clone() })?
                .texture()
                .clone();
            let placed = self.run(context, encoder, "layer", &[&next], Some(uniforms(&[
                width as f32, height as f32, t.center_x, t.center_y,
                t.width, t.height, t.rotation_degrees.to_radians(), 0.0,
                crop.left, crop.top, crop.right, crop.bottom,
                if t.flip_x { 1.0 } else { 0.0 }, if t.flip_y { 1.0 } else { 0.0 },
            ])), width, height);
            let shader = library_shader("frame-blend").expect("the library holds frame-blend");
            let mix = HashMap::from([("u_mix".to_string(), EffectUniformValueDescriptor::Number(blend.mix.clamp(0.0, 1.0)))]);
            current = self.run_library(context, encoder, shader, &[&current, &current, &placed], &mix, layer.box_inverse.as_ref(), 0.0, width, height);
        }

        if let Some(key) = &layer.key {
            self.report.stages.push("chroma-key");
            current = self.run(context, encoder, "chroma-key", &[&current], Some(uniforms(&[
                key.key_color[0], key.key_color[1], key.key_color[2], 0.0,
                key.similarity, key.smoothness, key.shadow, key.spill,
            ])), width, height);
            if key.show_matte {
                let shader = library_shader("matte-view").expect("the library holds matte-view");
                current = self.run_library(context, encoder, shader, &[&current, &current, &current], &HashMap::new(), layer.box_inverse.as_ref(), 0.0, width, height);
            }
        }

        if let Some(color) = &layer.color {
            self.report.stages.push("color-chain");
            current = self.color_chain(context, encoder, &current, color, layer.box_inverse.as_ref(), width, height);
        }

        if let Some(filter) = &layer.filter {
            self.report.stages.push("filter");
            current = self.filter(context, encoder, &current, filter, width, height);
        }

        if !layer.effect_pass_groups.is_empty() {
            self.report.stages.push("effects");
            // The person matte goes through the layer's own crop, flip and transform, then is upsampled along the picture's edges.
            let matte = match &layer.person_matte {
                Some(matte) => {
                    let stored = self
                        .textures
                        .get(&matte.texture_id)
                        .ok_or_else(|| CompositorError::MissingTexture { texture_id: matte.texture_id.clone() })?
                        .texture()
                        .clone();
                    let placed = self.run(context, encoder, "layer", &[&stored], Some(uniforms(&[
                        width as f32, height as f32, t.center_x, t.center_y,
                        t.width, t.height, t.rotation_degrees.to_radians(), 0.0,
                        crop.left, crop.top, crop.right, crop.bottom,
                        if t.flip_x { 1.0 } else { 0.0 }, if t.flip_y { 1.0 } else { 0.0 },
                    ])), width, height);
                    let upsample = EffectPassDescriptor {
                        shader: "matte-upsample".to_string(),
                        uniforms: HashMap::from([("u_matteSize".to_string(), EffectUniformValueDescriptor::Vector(vec![matte.width, matte.height]))]),
                        textures: None,
                        store: None,
                    };
                    // `cur` = the placed matte, `orig` = the picture that guides the upsampling.
                    let shader = library_shader("matte-upsample").expect("the library holds matte-upsample");
                    Some(self.run_library(context, encoder, shader, &[&placed, &current, &current], &upsample.uniforms, layer.box_inverse.as_ref(), 0.0, width, height))
                }
                None => None,
            };
            current = self.apply_effect_groups(context, encoder, &current, width, height, &layer.effect_pass_groups, layer.box_inverse.as_ref(), matte.as_ref());
        }

        if !layer.masks.is_empty() {
            self.report.stages.push("masks");
            let coverage = self.mask_coverage(context, encoder, &layer.masks, width, height)?;
            current = self.run(context, encoder, "mask-apply", &[&current, &coverage], None, width, height);
        }
        if !layer.post_passes.is_empty() {
            if layer.post_passes.iter().any(|pass| pass.shader == "wipe-reveal") && layer.masks.is_empty() {
                self.report.stages.push("masks");
            }
            if layer.post_passes.iter().any(|pass| pass.shader == "motion-blur") {
                self.report.stages.push("motion-blur");
            }
            for pass in &layer.post_passes {
                // The reveal is drawn in the element box; the motion blur leaves it, so its frame is the canvas.
                let frame = if pass.shader == "motion-blur" { None } else { layer.box_inverse.as_ref() };
                current = self.apply_effect_groups(context, encoder, &current, width, height, &[vec![pass.clone()]], frame, None);
            }
        }
        Ok(current)
    }

    /// Combined coverage of a mask list: each mask feathered on its own, then folded in list order.
    fn mask_coverage(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        masks: &[LayerMaskDescriptor],
        width: u32,
        height: u32,
    ) -> Result<wgpu::Texture, CompositorError> {
        if masks.len() > MAX_MASKS {
            self.diagnose("mask/limit-exceeded", &masks[MAX_MASKS].texture_id);
        }
        let initial = masks[0].combine.initial_coverage();
        let mut coverage = self.cleared(context, encoder, width, height, [initial, initial, initial, 1.0]);
        for mask in masks.iter().take(MAX_MASKS) {
            let source = self
                .textures
                .get(&mask.texture_id)
                .ok_or_else(|| CompositorError::MissingTexture { texture_id: mask.texture_id.clone() })?
                .texture()
                .clone();
            let shaped = if mask.feather > 0.0 {
                let key = (mask.texture_id.clone(), mask.feather.to_bits(), width, height);
                let frame_index = self.frame_index;
                if let Some(entry) = self.feathered.get_mut(&key) {
                    entry.1 = frame_index;
                    entry.0.clone()
                } else {
                    self.report.passes += 1;
                    let made = self.masks.apply_mask_feather_with_encoder(context, encoder, ApplyMaskFeatherOptions {
                        mask: &source,
                        width,
                        height,
                        feather: mask.feather,
                    });
                    if self.feathered.len() >= FEATHER_CACHE_LIMIT {
                        // The one used longest ago makes room.
                        if let Some(oldest) = self.feathered.iter().min_by_key(|(_, entry)| entry.1).map(|(key, _)| key.clone()) {
                            self.feathered.remove(&oldest);
                        }
                    }
                    self.feathered.insert(key, (made.clone(), frame_index));
                    made
                }
            } else {
                source
            };
            coverage = self.run(context, encoder, "mask-combine", &[&coverage, &shaped], Some(uniforms(&[
                mask.combine.shader_code(), mask.opacity.clamp(0.0, 1.0), if mask.inverted { 1.0 } else { 0.0 },
            ])), width, height);
        }
        Ok(coverage)
    }

    /// Runs effect pass groups. A pass naming an unknown shader or an undeclared uniform is skipped and reported.
    /// Within a group a library pass reads the previous pass (`cur`), the group's input (`orig`) and `aux`.
    #[allow(clippy::too_many_arguments)]
    fn apply_effect_groups(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        width: u32,
        height: u32,
        groups: &[Vec<EffectPassDescriptor>],
        frame: Frame<'_>,
        matte: Option<&wgpu::Texture>,
    ) -> wgpu::Texture {
        let mut current = source.clone();
        for group in groups {
            let input = current.clone();
            let mut stored: HashMap<&str, wgpu::Texture> = HashMap::new();
            for pass in group {
                if self.effects.has_shader(&pass.shader) {
                    let mapped = [EffectPass {
                        shader: pass.shader.clone(),
                        uniforms: pass.uniforms.iter().map(|(name, value)| (name.clone(), match value {
                            EffectUniformValueDescriptor::Number(number) => UniformValue::Number(*number),
                            EffectUniformValueDescriptor::Vector(vector) => UniformValue::Vector(vector.clone()),
                        })).collect(),
                    }];
                    // The pass draws into a pooled target: no texture is created per frame.
                    let target = [self.texture_pool.acquire(context, width, height, "effects-pass-output")];
                    match self.effects.apply_with_encoder(context, encoder, ApplyEffectsOptions { source: &current, width, height, passes: &mapped, outputs: Some(&target) }) {
                        Ok(output) => {
                            self.report.passes += 1;
                            current = output;
                        }
                        Err(_) => {
                            self.diagnose("shader/unsupported", &pass.shader);
                            continue;
                        }
                    }
                } else if let Some(shader) = library_shader(&pass.shader).filter(|shader| shader.kind == LibraryKind::Effect) {
                    if pass.uniforms.keys().any(|name| shader.slot(name).is_none() && !ENGINE_UNIFORMS.contains(&name.as_str())) {
                        self.diagnose("shader/unsupported", &pass.shader);
                        continue;
                    }
                    let aux = match pass.textures.as_ref().and_then(|textures| textures.get("aux")) {
                        None => Some(input.clone()),
                        Some(name) if name == "@matte" => matte.cloned(),
                        Some(name) if name.starts_with('@') => stored.get(&name[1..]).cloned(),
                        Some(id) => self.textures.get(id).map(|texture| texture.texture().clone()),
                    };
                    let Some(aux) = aux else {
                        // The input the pass needs is not there (a matte that is not computed yet): the pass is skipped.
                        self.diagnose("shader/input-unavailable", &pass.shader);
                        continue;
                    };
                    current = self.run_library(context, encoder, shader, &[&current, &input, &aux], &pass.uniforms, frame, 0.0, width, height);
                } else {
                    self.diagnose("shader/unsupported", &pass.shader);
                    continue;
                }
                if let Some(name) = &pass.store {
                    stored.insert(name.as_str(), current.clone());
                }
            }
        }
        current
    }

    /// Runs one library shader. The engine slots are filled from the frame and the pass's `u_time`, `u_frame` and
    /// `u_progress`; the shader's own uniforms go to their declared slots.
    #[allow(clippy::too_many_arguments)]
    fn run_library(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        shader: &'static LibraryShader,
        inputs: &[&wgpu::Texture],
        map: &HashMap<String, EffectUniformValueDescriptor>,
        frame: Frame<'_>,
        progress: f32,
        width: u32,
        height: u32,
    ) -> wgpu::Texture {
        let (w, h) = (width as f32, height as f32);
        let mut values = [0.0; UNIFORM_FLOATS];
        values[0] = w;
        values[1] = h;
        values[2] = w.max(h) / 1920.0;
        values[3] = uniform_number(map, "u_time", 0.0);
        values[4] = uniform_number(map, "u_progress", progress);
        values[5] = uniform_number(map, "u_frame", 0.0);
        // Canvas pixel → frame uv, and back.
        let m = frame.copied().unwrap_or([1.0 / w, 0.0, 0.0, 0.0, 1.0 / h, 0.0, 0.0, 0.0, 1.0]);
        let determinant = m[0] * m[4] - m[1] * m[3];
        let determinant = if determinant.abs() < 1e-20 { 1e-20 } else { determinant };
        let inverse = [m[4] / determinant, -m[1] / determinant, -m[3] / determinant, m[0] / determinant];
        values[8..12].copy_from_slice(&[m[0], m[1], m[2], 1.0 / m[0].hypot(m[1]).max(1e-9)]);
        values[12..16].copy_from_slice(&[m[3], m[4], m[5], 1.0 / m[3].hypot(m[4]).max(1e-9)]);
        values[16..20].copy_from_slice(&[inverse[0], inverse[1], -(inverse[0] * m[2] + inverse[1] * m[5]), 0.0]);
        values[20..24].copy_from_slice(&[inverse[2], inverse[3], -(inverse[2] * m[2] + inverse[3] * m[5]), 0.0]);
        for (name, value) in map {
            let Some((slot, components)) = shader.slot(name) else { continue };
            match value {
                EffectUniformValueDescriptor::Number(number) => values[slot * 4] = *number,
                EffectUniformValueDescriptor::Vector(vector) => {
                    for (index, component) in vector.iter().take(components.max(1)).enumerate() {
                        values[slot * 4 + index] = *component;
                    }
                }
            }
        }
        if !self.passes.contains_key(shader.id.as_str()) {
            let pass = build_pass(context, &self.vertex, &self.uniform_layout, "library-shader", &shader.source, shader.texture_count(), true);
            self.passes.insert(shader.id.as_str(), pass);
        }
        self.run(context, encoder, shader.id.as_str(), inputs, Some(values), width, height)
    }

    /// The `filter` stage: the baked table of the filter entry, mixed by its intensity.
    fn filter(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        filter: &LutDescriptor,
        width: u32,
        height: u32,
    ) -> wgpu::Texture {
        let chain = ColorChainDescriptor { lut: Some(filter.clone()), basic: None, wheels: None, curves_texture_id: None, hsl: None, spatial: None, detail: None };
        self.color_chain(context, encoder, source, &chain, None, width, height)
    }

    fn render_scene_effect(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        scene: &wgpu::Texture,
        effect: &SceneEffectDescriptor,
        width: u32,
        height: u32,
    ) -> Result<wgpu::Texture, CompositorError> {
        let graded = match &effect.color {
            Some(color) => self.color_chain(context, encoder, scene, color, None, width, height),
            None => scene.clone(),
        };
        let graded = match &effect.filter {
            Some(filter) => self.filter(context, encoder, &graded, filter, width, height),
            None => graded,
        };
        let processed = self.apply_effect_groups(context, encoder, &graded, width, height, &effect.effect_pass_groups, None, None);
        if effect.masks.is_empty() && effect.opacity >= 1.0 {
            return Ok(processed);
        }
        let coverage = if effect.masks.is_empty() {
            self.cleared(context, encoder, width, height, [1.0; 4])
        } else {
            self.mask_coverage(context, encoder, &effect.masks, width, height)?
        };
        Ok(self.run(context, encoder, "scene-mix", &[scene, &processed, &coverage], Some(uniforms(&[effect.opacity.clamp(0.0, 1.0)])), width, height))
    }

    /// The colour chain as one pass. Tables that a chain does not use are bound to the picture itself and never read.
    fn color_chain(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        color: &ColorChainDescriptor,
        box_inverse: Option<&[f32; 9]>,
        width: u32,
        height: u32,
    ) -> wgpu::Texture {
        // Sharpness and clarity read the picture after HSL and before fade, so the chain then runs in pieces:
        // steps 1–5, the two unsharp passes, fade and vignette, grain.
        if let Some(detail) = color.detail.filter(|detail| detail[..3].iter().any(|value| *value != 0.0)) {
            let s = (width as f32).max(height as f32) / 1920.0;
            let mut current = source.clone();
            let pointwise = ColorChainDescriptor { spatial: None, detail: None, ..color.clone() };
            if pointwise.lut.is_some() || pointwise.basic.is_some() || pointwise.wheels.is_some() || pointwise.curves_texture_id.is_some() || pointwise.hsl.is_some() {
                current = self.color_chain(context, encoder, &current, &pointwise, box_inverse, width, height);
            }
            let number = |value: f32| EffectUniformValueDescriptor::Number(value);
            let step = |shader: &str, amount: f32, sigma: f32| -> Vec<EffectPassDescriptor> {
                let mut passes = gaussian_passes(sigma);
                passes.push(EffectPassDescriptor { shader: shader.to_string(), uniforms: HashMap::from([("u_amount".to_string(), number(amount))]), textures: None, store: None });
                passes
            };
            let mut groups = Vec::new();
            if detail[0] != 0.0 {
                groups.push(step("color-sharpen", detail[0], 1.5 * s));
            }
            if detail[1] != 0.0 {
                groups.push(step("color-clarity", detail[1], 40.0 * s));
            }
            current = self.apply_effect_groups(context, encoder, &current, width, height, &groups, box_inverse, None);
            if color.spatial.is_some() {
                let spatial = ColorChainDescriptor { lut: None, basic: None, wheels: None, curves_texture_id: None, hsl: None, spatial: color.spatial, detail: None };
                current = self.color_chain(context, encoder, &current, &spatial, box_inverse, width, height);
            }
            if detail[2] != 0.0 {
                let grain = vec![EffectPassDescriptor {
                    shader: "color-grain".to_string(),
                    uniforms: HashMap::from([("u_amount".to_string(), number(detail[2])), ("u_frame".to_string(), number(detail[3]))]),
                    textures: None,
                    store: None,
                }];
                current = self.apply_effect_groups(context, encoder, &current, width, height, &[grain], box_inverse, None);
            }
            return current;
        }
        let texture = |id: Option<&String>| id.and_then(|id| self.textures.get(id)).map(|stored| stored.texture().clone());
        let lut = texture(color.lut.as_ref().map(|lut| &lut.texture_id));
        let curves = texture(color.curves_texture_id.as_ref());
        let mut values = [0.0; UNIFORM_FLOATS];
        let flag = |on: bool| if on { 1.0 } else { 0.0 };
        values[0] = flag(lut.is_some());
        values[1] = flag(color.basic.is_some());
        values[2] = flag(color.wheels.is_some());
        values[3] = flag(curves.is_some());
        values[4] = flag(color.hsl.is_some());
        values[5] = flag(color.spatial.is_some());
        if let Some(table) = &color.lut {
            values[6] = table.size as f32;
            values[7] = table.intensity.clamp(0.0, 1.0);
        }
        if let Some(basic) = &color.basic {
            values[8..20].copy_from_slice(basic);
        }
        match &color.wheels {
            Some(wheels) => {
                values[20..23].copy_from_slice(&wheels[0..3]);
                values[24..27].copy_from_slice(&wheels[3..6]);
                values[28..31].copy_from_slice(&wheels[6..9]);
            }
            None => {
                values[24..27].copy_from_slice(&[1.0; 3]);
                values[28..31].copy_from_slice(&[1.0; 3]);
            }
        }
        if let Some(hsl) = &color.hsl {
            values[32..56].copy_from_slice(hsl);
        }
        if let Some(spatial) = &color.spatial {
            values[56..58].copy_from_slice(spatial);
            // The effect frame: the element box for a clip, the canvas for an adjustment layer. Positions are
            // measured from its centre in px along its axes and divided by its half diagonal.
            let (w, h) = (width as f32, height as f32);
            let m = box_inverse.copied().unwrap_or([1.0 / w, 0.0, 0.0, 0.0, 1.0 / h, 0.0, 0.0, 0.0, 1.0]);
            let box_width = 1.0 / m[0].hypot(m[1]).max(1e-9);
            let box_height = 1.0 / m[3].hypot(m[4]).max(1e-9);
            let half_diagonal = box_width.hypot(box_height) / 2.0;
            let (sx, sy) = (box_width / half_diagonal, box_height / half_diagonal);
            values[58] = m[0] * w * sx;
            values[59] = m[1] * h * sx;
            values[60] = m[3] * w * sy;
            values[61] = m[4] * h * sy;
            values[62] = (m[2] - 0.5) * sx;
            values[63] = (m[5] - 0.5) * sy;
        }
        let lut = lut.unwrap_or_else(|| source.clone());
        let curves = curves.unwrap_or_else(|| source.clone());
        self.run(context, encoder, "color-chain", &[source, &lut, &curves], Some(values), width, height)
    }

    /// One side of a transition: its background, when it carries one, with the clip drawn over it through its own
    /// chain up to and including `opacity`.
    fn render_transition_side(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        layer: &LayerDescriptor,
        background: Option<&Vec<FrameItemDescriptor>>,
        width: u32,
        height: u32,
    ) -> Result<wgpu::Texture, CompositorError> {
        let base = match background {
            Some(items) => self.render_items(context, encoder, items, width, height, [0.0; 4])?,
            None => self.cleared(context, encoder, width, height, [0.0; 4]),
        };
        let texture = self.render_layer(context, encoder, layer, width, height)?;
        self.report.stages.push("opacity");
        Ok(self.blend(context, encoder, &base, &texture, BlendMode::NORMAL, layer.opacity, width, height))
    }

    fn render_transition(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        scene: &wgpu::Texture,
        transition: &TransitionDescriptor,
        width: u32,
        height: u32,
    ) -> Result<wgpu::Texture, CompositorError> {
        let from = self.render_transition_side(context, encoder, &transition.from, transition.from_background.as_ref(), width, height)?;
        let to = self.render_transition_side(context, encoder, &transition.to, transition.to_background.as_ref(), width, height)?;
        let progress = transition.progress.clamp(0.0, 1.0);
        // An id the registry does not hold renders as a cross-dissolve of the same progress.
        let shader = match library_shader(&transition.shader).filter(|shader| shader.kind == LibraryKind::Transition) {
            Some(shader) => shader,
            None => {
                self.diagnose("shader/unknown-transition", &transition.shader);
                library_shader("cross-dissolve").expect("the library holds cross-dissolve")
            }
        };
        let mut combined = self.run_library(context, encoder, shader, &[&from, &to], &transition.uniforms, None, progress, width, height);
        if !transition.post_passes.is_empty() {
            combined = self.apply_effect_groups(context, encoder, &combined, width, height, std::slice::from_ref(&transition.post_passes), None, None);
        }
        let id = if progress < 0.5 { &transition.blend_mode_from } else { &transition.blend_mode_to };
        let mode = self.blend_mode(id);
        self.report.stages.push("blend");
        Ok(self.blend(context, encoder, scene, &combined, mode, 1.0, width, height))
    }

    #[allow(clippy::too_many_arguments)]
    fn blend(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        base: &wgpu::Texture,
        layer: &wgpu::Texture,
        mode: BlendMode,
        opacity: f32,
        width: u32,
        height: u32,
    ) -> wgpu::Texture {
        self.run(context, encoder, "blend", &[base, layer], Some(uniforms(&[mode.shader_code() as f32, opacity.clamp(0.0, 1.0)])), width, height)
    }

    fn cleared(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        width: u32,
        height: u32,
        color: [f32; 4],
    ) -> wgpu::Texture {
        let texture = self.texture_pool.acquire(context, width, height, "compositor-cleared-texture");
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("compositor-clear-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: f64::from(color[0]),
                        g: f64::from(color[1]),
                        b: f64::from(color[2]),
                        a: f64::from(color[3]),
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
            multiview_mask: None,
        });
        texture
    }

    /// Runs one full-screen pass into a pooled target and returns the target.
    #[allow(clippy::too_many_arguments)]
    fn run(
        &mut self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        pass_id: &'static str,
        inputs: &[&wgpu::Texture],
        uniform_values: Option<Uniforms>,
        width: u32,
        height: u32,
    ) -> wgpu::Texture {
        let target = self.texture_pool.acquire(context, width, height, "compositor-pass-target");
        let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let device = context.device();
        let texture_groups: Vec<wgpu::BindGroup> = inputs
            .iter()
            .map(|texture| {
                let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
                device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("compositor-pass-texture"),
                    layout: context.texture_sampler_bind_group_layout(),
                    entries: &[
                        wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(context.linear_sampler()) },
                    ],
                })
            })
            .collect();
        let pass = &self.passes[pass_id];
        let uniform_group = pass.uniform_group.map(|_| {
            let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("compositor-pass-uniforms"),
                contents: bytemuck::cast_slice(&uniform_values.unwrap_or([0.0; UNIFORM_FLOATS])),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("compositor-pass-uniform-group"),
                layout: &self.uniform_layout,
                entries: &[wgpu::BindGroupEntry { binding: 0, resource: buffer.as_entire_binding() }],
            })
        });
        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(pass_id),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target_view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            render_pass.set_pipeline(&pass.pipeline);
            render_pass.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
            for (index, group) in texture_groups.iter().enumerate() {
                render_pass.set_bind_group(index as u32, group, &[]);
            }
            if let (Some(index), Some(group)) = (pass.uniform_group, uniform_group.as_ref()) {
                render_pass.set_bind_group(index, group, &[]);
            }
            render_pass.draw(0..6, 0..1);
        }
        self.report.passes += 1;
        target
    }
}
