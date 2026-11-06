use std::collections::HashMap;

use serde::{Deserialize, Deserializer, Serialize};

/// The descriptor version this compositor renders.
pub const FRAME_DESCRIPTOR_VERSION: u32 = 3;
/// Masks applied per layer; further ones are dropped with `mask/limit-exceeded`.
pub const MAX_MASKS: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameDescriptor {
    pub version: u32,
    pub width: u32,
    pub height: u32,
    pub clear: CanvasClearDescriptor,
    pub items: Vec<FrameItemDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasClearDescriptor {
    pub color: [f32; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FrameItemDescriptor {
    Layer(LayerDescriptor),
    Transition(TransitionDescriptor),
    SceneEffect(SceneEffectDescriptor),
    Group(GroupDescriptor),
}

/// A stage of the descriptor schema that this build of the compositor does not execute. It accepts only `null`:
/// a descriptor that asks for the stage is refused instead of being rendered without it.
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct StageAbsent;

impl<'de> Deserialize<'de> for StageAbsent {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match Option::<serde::de::IgnoredAny>::deserialize(deserializer)? {
            None => Ok(Self),
            Some(_) => Err(serde::de::Error::custom("this stage is not available in the compositor")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerDescriptor {
    /// Present when the layer is written as a side of a transition, where no enum tag consumes it.
    #[serde(default, rename = "type", skip_serializing)]
    pub kind: Option<String>,
    pub texture_id: String,
    #[serde(default)]
    pub crop: CropDescriptor,
    pub transform: QuadTransformDescriptor,
    #[serde(default)]
    pub key: Option<ChromaKeyDescriptor>,
    #[serde(default)]
    pub effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    #[serde(default)]
    pub masks: Vec<LayerMaskDescriptor>,
    pub opacity: f32,
    pub blend_mode: String,
    /// Row-major 3×3 matrix from canvas pixels to the element box; carried for effect shaders.
    #[serde(default)]
    pub box_inverse: Option<[f32; 9]>,
    #[serde(default)]
    pub stabilise: StageAbsent,
    #[serde(default)]
    pub matte: StageAbsent,
    #[serde(default)]
    pub cutout_background: StageAbsent,
    #[serde(default)]
    pub cutout_stroke: StageAbsent,
    /// The person matte of the source frame, for the body effects; drawn through the layer's own transform.
    #[serde(default)]
    pub person_matte: Option<PersonMatteDescriptor>,
    #[serde(default)]
    pub analysis: StageAbsent,
    #[serde(default)]
    pub color: Option<ColorChainDescriptor>,
    /// The baked table of the element's filter entry, sampled after the colour chain.
    #[serde(default)]
    pub filter: Option<LutDescriptor>,
    #[serde(default)]
    pub mask_stroke: StageAbsent,
    #[serde(default)]
    pub reveal: StageAbsent,
    #[serde(default)]
    pub motion_blur: StageAbsent,
    /// The second source frame of a frame-blended slow motion and its weight: the source is `mix(texture, blend, mix)`.
    #[serde(default)]
    pub blend_source: Option<BlendSourceDescriptor>,
    /// Passes run on the layer after its masks: the clip-animation reveal, then the motion blur.
    #[serde(default)]
    pub post_passes: Vec<EffectPassDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlendSourceDescriptor {
    pub texture_id: String,
    pub mix: f32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CropDescriptor {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuadTransformDescriptor {
    pub center_x: f32,
    pub center_y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation_degrees: f32,
    pub flip_x: bool,
    pub flip_y: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChromaKeyDescriptor {
    pub key_color: [f32; 3],
    pub similarity: f32,
    pub smoothness: f32,
    pub shadow: f32,
    pub spill: f32,
    /// A view of the key: the kept alpha as greyscale, opaque, instead of the keyed picture.
    #[serde(default)]
    pub show_matte: bool,
}

/// The colour chain of a layer or of an adjustment layer. Absent steps are identity and cost nothing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ColorChainDescriptor {
    #[serde(default)]
    pub lut: Option<LutDescriptor>,
    /// exposure, brightness, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance
    /// as `slider / 100`, then hue in degrees.
    #[serde(default)]
    pub basic: Option<[f32; 12]>,
    /// Lift, gamma and gain per channel: nine values.
    #[serde(default)]
    pub wheels: Option<[f32; 9]>,
    /// A 256×1 texture: the channel curves in r, g, b and the master curve in alpha.
    #[serde(default)]
    pub curves_texture_id: Option<String>,
    /// Eight bands × (hue, saturation, lightness) as `slider / 100`.
    #[serde(default)]
    pub hsl: Option<[f32; 24]>,
    /// Fade and vignette as `slider / 100`.
    #[serde(default)]
    pub spatial: Option<[f32; 2]>,
    /// Sharpness, clarity and grain as `slider / 100`, then the frame index the grain is seeded with.
    #[serde(default)]
    pub detail: Option<[f32; 4]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonMatteDescriptor {
    pub texture_id: String,
    /// Stored size of the matte in its own pixels.
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LutDescriptor {
    /// A 2D-packed table: `size × size` wide, `size` tall, slices along blue side by side.
    pub texture_id: String,
    pub size: u32,
    pub intensity: f32,
}

impl ColorChainDescriptor {
    fn is_finite(&self) -> bool {
        self.lut.as_ref().is_none_or(|lut| lut.intensity.is_finite() && (2..=65).contains(&lut.size))
            && self.basic.as_ref().is_none_or(|values| all_finite(values))
            && self.wheels.as_ref().is_none_or(|values| all_finite(values))
            && self.hsl.as_ref().is_none_or(|values| all_finite(values))
            && self.spatial.as_ref().is_none_or(|values| all_finite(values))
            && self.detail.as_ref().is_none_or(|values| all_finite(values))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MaskCombine {
    Add,
    Subtract,
    Intersect,
    Exclude,
}

impl MaskCombine {
    pub fn shader_code(self) -> f32 {
        match self {
            Self::Add => 0.0,
            Self::Subtract => 1.0,
            Self::Intersect => 2.0,
            Self::Exclude => 3.0,
        }
    }

    /// The accumulator starts empty for a first mask that adds or excludes, full for one that subtracts or intersects.
    pub fn initial_coverage(self) -> f32 {
        match self {
            Self::Add | Self::Exclude => 0.0,
            Self::Subtract | Self::Intersect => 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerMaskDescriptor {
    pub texture_id: String,
    pub feather: f32,
    pub inverted: bool,
    pub opacity: f32,
    pub combine: MaskCombine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransitionDescriptor {
    pub from: Box<LayerDescriptor>,
    pub to: Box<LayerDescriptor>,
    pub shader: String,
    #[serde(default)]
    pub uniforms: HashMap<String, EffectUniformValueDescriptor>,
    /// Eased progress, 0…1.
    pub progress: f32,
    pub blend_mode_from: String,
    pub blend_mode_to: String,
    /// Passes run on the shader's result before it is blended (the Gaussian of a blur dissolve, the bloom of a glow dissolve).
    #[serde(default)]
    pub post_passes: Vec<EffectPassDescriptor>,
    #[serde(default)]
    pub from_background: Option<Vec<FrameItemDescriptor>>,
    #[serde(default)]
    pub to_background: Option<Vec<FrameItemDescriptor>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneEffectDescriptor {
    #[serde(default)]
    pub effect_pass_groups: Vec<Vec<EffectPassDescriptor>>,
    #[serde(default)]
    pub masks: Vec<LayerMaskDescriptor>,
    #[serde(default = "one")]
    pub opacity: f32,
    #[serde(default)]
    pub color: Option<ColorChainDescriptor>,
    #[serde(default)]
    pub filter: Option<LutDescriptor>,
}

fn one() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupDescriptor {
    pub items: Vec<FrameItemDescriptor>,
    pub target_texture_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectPassDescriptor {
    pub shader: String,
    pub uniforms: HashMap<String, EffectUniformValueDescriptor>,
    /// `aux`: a texture id, or `@name` for the output of an earlier pass of the group stored under that name
    /// (`@matte` is the layer's person matte).
    #[serde(default)]
    pub textures: Option<HashMap<String, String>>,
    /// Keeps this pass's output under a name for a later pass of the same group.
    #[serde(default)]
    pub store: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EffectUniformValueDescriptor {
    Number(f32),
    Vector(Vec<f32>),
}

impl EffectUniformValueDescriptor {
    fn is_finite(&self) -> bool {
        match self {
            Self::Number(value) => value.is_finite(),
            Self::Vector(values) => values.iter().all(|value| value.is_finite()),
        }
    }
}

fn all_finite(values: &[f32]) -> bool {
    values.iter().all(|value| value.is_finite())
}

fn passes_finite(groups: &[Vec<EffectPassDescriptor>]) -> bool {
    groups.iter().flatten().all(|pass| pass.uniforms.values().all(EffectUniformValueDescriptor::is_finite))
}

fn masks_finite(masks: &[LayerMaskDescriptor]) -> bool {
    masks.iter().all(|mask| mask.feather.is_finite() && mask.opacity.is_finite())
}

impl LayerDescriptor {
    fn is_finite(&self) -> bool {
        let t = &self.transform;
        all_finite(&[t.center_x, t.center_y, t.width, t.height, t.rotation_degrees, self.opacity])
            && all_finite(&[self.crop.left, self.crop.top, self.crop.right, self.crop.bottom])
            && self.key.as_ref().is_none_or(|key| {
                all_finite(&key.key_color) && all_finite(&[key.similarity, key.smoothness, key.shadow, key.spill])
            })
            && self.box_inverse.as_ref().is_none_or(|matrix| all_finite(matrix))
            && self.color.as_ref().is_none_or(ColorChainDescriptor::is_finite)
            && self.filter.as_ref().is_none_or(|lut| lut.intensity.is_finite())
            && self.person_matte.as_ref().is_none_or(|matte| matte.width.is_finite() && matte.height.is_finite())
            && passes_finite(&self.effect_pass_groups)
            && passes_finite(std::slice::from_ref(&self.post_passes))
            && self.blend_source.as_ref().is_none_or(|blend| blend.mix.is_finite())
            && masks_finite(&self.masks)
    }
}

impl FrameItemDescriptor {
    fn is_finite(&self) -> bool {
        match self {
            Self::Layer(layer) => layer.is_finite(),
            Self::Transition(transition) => {
                transition.progress.is_finite()
                    && transition.from.is_finite()
                    && transition.to.is_finite()
                    && transition.uniforms.values().all(EffectUniformValueDescriptor::is_finite)
                    && passes_finite(std::slice::from_ref(&transition.post_passes))
                    && [&transition.from_background, &transition.to_background]
                        .into_iter()
                        .flatten()
                        .all(|items| items.iter().all(Self::is_finite))
            }
            Self::SceneEffect(effect) => {
                effect.opacity.is_finite()
                    && passes_finite(&effect.effect_pass_groups)
                    && masks_finite(&effect.masks)
                    && effect.color.as_ref().is_none_or(ColorChainDescriptor::is_finite)
            }
            Self::Group(group) => group.items.iter().all(Self::is_finite),
        }
    }
}

impl FrameDescriptor {
    /// What `descriptor/invalid` covers beyond the shape of the data: the version, the size and every number finite.
    pub fn validate(&self) -> Result<(), String> {
        if self.version != FRAME_DESCRIPTOR_VERSION {
            return Err(format!("descriptor version {} is not supported", self.version));
        }
        if self.width == 0 || self.height == 0 {
            return Err("the frame has no size".to_string());
        }
        if !all_finite(&self.clear.color) || !self.items.iter().all(FrameItemDescriptor::is_finite) {
            return Err("every number of a descriptor is finite".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::FrameDescriptor;

    fn parse(json: &str) -> Result<FrameDescriptor, String> {
        let frame: FrameDescriptor = serde_json::from_str(json).map_err(|error| error.to_string())?;
        frame.validate()?;
        Ok(frame)
    }

    const LAYER: &str = r#"{"type":"layer","textureId":"a","crop":{"left":0,"top":0,"right":0,"bottom":0},"transform":{"centerX":1,"centerY":1,"width":2,"height":2,"rotationDegrees":0,"flipX":false,"flipY":false},"key":null,"matte":null,"stabilise":null,"analysis":null,"color":null,"filter":null,"maskStroke":null,"reveal":null,"motionBlur":null,"effectPassGroups":[],"masks":[],"opacity":1,"blendMode":"normal"}"#;

    fn frame(version: u32, items: &str) -> String {
        format!(r#"{{"version":{version},"width":4,"height":4,"clear":{{"color":[0,0,0,1]}},"items":[{items}]}}"#)
    }

    #[test]
    fn accepts_a_minimal_descriptor() {
        assert!(parse(&frame(3, LAYER)).is_ok());
    }

    #[test]
    fn rejects_an_unknown_version_item_kind_and_combine() {
        assert!(parse(&frame(2, LAYER)).is_err());
        assert!(parse(&frame(3, r#"{"type":"hologram"}"#)).is_err());
        let masked = LAYER.replace(r#""masks":[]"#, r#""masks":[{"textureId":"m","feather":0,"inverted":false,"opacity":1,"combine":"xor"}]"#);
        assert!(parse(&frame(3, &masked)).is_err());
        let excluded = LAYER.replace(r#""masks":[]"#, r#""masks":[{"textureId":"m","feather":0,"inverted":false,"opacity":0.5,"combine":"exclude"}]"#);
        assert!(parse(&frame(3, &excluded)).is_ok());
    }

    #[test]
    fn rejects_a_non_finite_number() {
        let mut descriptor = parse(&frame(3, LAYER)).unwrap();
        if let super::FrameItemDescriptor::Layer(layer) = &mut descriptor.items[0] {
            layer.opacity = f32::NAN;
        }
        assert!(descriptor.validate().is_err());
    }

    #[test]
    fn refuses_a_stage_the_compositor_does_not_execute() {
        let with_matte = LAYER.replace(r#""matte":null"#, r#""matte":{"textureId":"m","inverted":false,"feather":0,"shift":0}"#);
        assert!(parse(&frame(3, &with_matte)).is_err());
    }
}
