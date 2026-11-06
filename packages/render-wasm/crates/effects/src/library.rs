//! The shader library: every effect and transition of the catalogues as a WGSL fragment shader, keyed by id, with
//! a typed uniform declaration per shader. The sources are sections of two files; a section is compiled with the
//! shared prelude and the accessors generated from its declaration.
use std::sync::OnceLock;

const COMMON: &str = include_str!("library/common.wgsl");
const EFFECT_PRELUDE: &str = include_str!("library/effect_prelude.wgsl");
const TRANSITION_PRELUDE: &str = include_str!("library/transition_prelude.wgsl");
const EFFECTS: &str = include_str!("library/effects.wgsl");
const TRANSITIONS: &str = include_str!("library/transitions.wgsl");

/// The first uniform slot of a shader's own uniforms; the slots before it are the engine's (see `common.wgsl`).
pub const FIRST_UNIFORM_SLOT: usize = 6;
/// Slots of the uniform block (`array<vec4f, 16>`).
pub const UNIFORM_SLOTS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LibraryKind {
    /// Reads `cur`, `orig` and `aux`; defines `effect(uv, px)`.
    Effect,
    /// Reads `A` and `B`; defines `transition(uv, p)`.
    Transition,
}

/// A uniform of a library shader: its name without the `u_` prefix and its component count (1 = `f32`, 2…4 = `vecN`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryUniform {
    pub name: String,
    pub components: usize,
}

#[derive(Debug, Clone)]
pub struct LibraryShader {
    pub id: String,
    pub kind: LibraryKind,
    pub uniforms: Vec<LibraryUniform>,
    /// The complete WGSL module.
    pub source: String,
    /// The section as written, which is what a review of the shader signs off.
    pub section: String,
}

impl LibraryShader {
    /// Texture inputs of the shader's pipeline.
    pub fn texture_count(&self) -> u32 {
        match self.kind {
            LibraryKind::Effect => 3,
            LibraryKind::Transition => 2,
        }
    }

    /// The slot a uniform is written to, by its descriptor name (`u_<name>`).
    pub fn slot(&self, descriptor_name: &str) -> Option<(usize, usize)> {
        let name = descriptor_name.strip_prefix("u_")?;
        self.uniforms.iter().position(|uniform| uniform.name == name).map(|index| (FIRST_UNIFORM_SLOT + index, self.uniforms[index].components))
    }
}

const EFFECT_MAIN: &str = r#"
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let px = input.tex_coord * R();
    let uv = to_uv(px);
    // A clip effect never writes a pixel outside its frame.
    if (!inside(uv)) {
        return textureSampleLevel(orig_texture, orig_sampler, input.tex_coord, 0.0);
    }
    return effect(uv, px);
}
"#;

const TRANSITION_MAIN: &str = r#"
@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let uv = input.tex_coord;
    let p = PROGRESS();
    // Every transition is the outgoing frame at p = 0 and the incoming frame at p = 1.
    var result = A(uv);
    if (p >= 1.0) {
        result = B(uv);
    } else if (p > 0.0) {
        result = transition(uv, p);
    }
    if (result.a <= 0.0) {
        return vec4f(0.0);
    }
    return vec4f(clamp(result.rgb / result.a, vec3f(0.0), vec3f(1.0)), clamp(result.a, 0.0, 1.0));
}
"#;

fn accessors(uniforms: &[LibraryUniform]) -> String {
    let mut out = String::new();
    for (index, uniform) in uniforms.iter().enumerate() {
        let slot = FIRST_UNIFORM_SLOT + index;
        let (kind, swizzle) = match uniform.components {
            1 => ("f32", ".x"),
            2 => ("vec2f", ".xy"),
            3 => ("vec3f", ".xyz"),
            _ => ("vec4f", ""),
        };
        out.push_str(&format!("fn u_{}() -> {kind} {{ return u.v[{slot}]{swizzle}; }}\n", uniform.name));
    }
    out
}

fn parse(file: &str, kind: LibraryKind, out: &mut Vec<LibraryShader>) {
    let (prelude, main) = match kind {
        LibraryKind::Effect => (EFFECT_PRELUDE, EFFECT_MAIN),
        LibraryKind::Transition => (TRANSITION_PRELUDE, TRANSITION_MAIN),
    };
    let mut current: Option<(String, Vec<LibraryUniform>, String)> = None;
    let finish = |entry: Option<(String, Vec<LibraryUniform>, String)>, out: &mut Vec<LibraryShader>| {
        if let Some((id, uniforms, section)) = entry {
            assert!(FIRST_UNIFORM_SLOT + uniforms.len() <= UNIFORM_SLOTS, "shader {id} declares too many uniforms");
            let source = format!("{COMMON}\n{prelude}\n{}\n{section}\n{main}", accessors(&uniforms));
            out.push(LibraryShader { id, kind, uniforms, source, section });
        }
    };
    for line in file.lines() {
        if let Some(header) = line.strip_prefix("//# ") {
            finish(current.take(), out);
            let (id, declaration) = header.split_once('|').expect("a section header is `//# id | uniforms`");
            let uniforms = declaration
                .split_whitespace()
                .map(|entry| match entry.split_once(':') {
                    Some((name, components)) => LibraryUniform { name: name.to_string(), components: components.parse().expect("a component count") },
                    None => LibraryUniform { name: entry.to_string(), components: 1 },
                })
                .collect();
            current = Some((id.trim().to_string(), uniforms, String::new()));
        } else if let Some((_, _, section)) = current.as_mut() {
            section.push_str(line);
            section.push('\n');
        }
    }
    finish(current.take(), out);
}

/// Every library shader, effects first, in file order.
pub fn library() -> &'static [LibraryShader] {
    static LIBRARY: OnceLock<Vec<LibraryShader>> = OnceLock::new();
    LIBRARY.get_or_init(|| {
        let mut out = Vec::new();
        parse(EFFECTS, LibraryKind::Effect, &mut out);
        parse(TRANSITIONS, LibraryKind::Transition, &mut out);
        out
    })
}

pub fn library_shader(id: &str) -> Option<&'static LibraryShader> {
    library().iter().find(|shader| shader.id == id)
}

/// 32-bit PCG output function (render-engine "Deterministic hash"); the WGSL twin is in `common.wgsl`.
pub fn pcg(x: u32) -> u32 {
    let s = x.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
    let w = ((s >> ((s >> 28) + 4)) ^ s).wrapping_mul(277_803_737);
    (w >> 22) ^ w
}
pub fn hash2(seed: u32, i: u32) -> u32 {
    pcg(pcg(seed).wrapping_add(i))
}
pub fn hash3(seed: u32, i: u32, j: u32) -> u32 {
    pcg(hash2(seed, i).wrapping_add(j))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_library_shader_is_valid_wgsl() {
        let mut failures = Vec::new();
        for shader in library() {
            match naga::front::wgsl::parse_str(&shader.source) {
                Err(error) => failures.push(format!("{}: {}", shader.id, error.emit_to_string(&shader.source))),
                Ok(module) => {
                    let mut validator = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty());
                    if let Err(error) = validator.validate(&module) {
                        failures.push(format!("{}: {}", shader.id, error.emit_to_string(&shader.source)));
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn every_library_shader_translates_to_glsl_es_300() {
        // The WebGL2 backend compiles the same modules through this translation.
        for shader in library() {
            let module = naga::front::wgsl::parse_str(&shader.source).unwrap_or_else(|error| panic!("{}: {error}", shader.id));
            let info = naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::empty())
                .validate(&module)
                .unwrap_or_else(|error| panic!("{}: {error}", shader.id));
            let mut text = String::new();
            let options = naga::back::glsl::Options { version: naga::back::glsl::Version::Embedded { version: 300, is_webgl: true }, ..Default::default() };
            let pipeline = naga::back::glsl::PipelineOptions { shader_stage: naga::ShaderStage::Fragment, entry_point: "fragment_main".to_string(), multiview: None };
            let mut writer = naga::back::glsl::Writer::new(&mut text, &module, &info, &options, &pipeline, naga::proc::BoundsCheckPolicies::default())
                .unwrap_or_else(|error| panic!("{}: {error}", shader.id));
            writer.write().unwrap_or_else(|error| panic!("{}: {error}", shader.id));
            assert!(text.contains("void main"), "{}", shader.id);
        }
    }

    #[test]
    fn ids_are_unique_and_the_catalogue_counts_hold() {
        let ids: Vec<&str> = library().iter().map(|shader| shader.id.as_str()).collect();
        let mut unique = ids.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), ids.len());
        assert_eq!(library().iter().filter(|shader| shader.kind == LibraryKind::Transition).count(), 55);
    }

    #[test]
    fn the_hash_matches_the_shared_vectors() {
        // `packages/editor-core/fixtures/hash-vectors.json`, written by the TypeScript implementation.
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../editor-core/fixtures/hash-vectors.json")).expect("the shared vector file");
        let mut cases = 0;
        for line in text.lines() {
            let numbers: Vec<u32> = line.trim().trim_start_matches('[').trim_end_matches(',').trim_end_matches(']').split(',').filter_map(|part| part.trim().parse().ok()).collect();
            if numbers.len() == 4 {
                assert_eq!(hash3(numbers[0], numbers[1], numbers[2]), numbers[3], "hash({}, {}, {})", numbers[0], numbers[1], numbers[2]);
                cases += 1;
            } else if numbers.len() == 3 {
                assert_eq!(hash2(numbers[0], numbers[1]), numbers[2], "hash({}, {})", numbers[0], numbers[1]);
                cases += 1;
            }
        }
        assert!(cases >= 1000, "{cases} cases");
    }
}
