// A scene effect mixes the unprocessed and the processed scene by its opacity times its mask coverage.
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct Uniforms {
    v: array<vec4f, 8>,
}

@group(0) @binding(0) var original_texture: texture_2d<f32>;
@group(0) @binding(1) var original_sampler: sampler;
@group(1) @binding(0) var processed_texture: texture_2d<f32>;
@group(1) @binding(1) var processed_sampler: sampler;
@group(2) @binding(0) var coverage_texture: texture_2d<f32>;
@group(2) @binding(1) var coverage_sampler: sampler;
@group(3) @binding(0) var<uniform> u: Uniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let original = textureSampleLevel(original_texture, original_sampler, input.tex_coord, 0.0);
    let processed = textureSampleLevel(processed_texture, processed_sampler, input.tex_coord, 0.0);
    let coverage = textureSampleLevel(coverage_texture, coverage_sampler, input.tex_coord, 0.0).r;
    return mix(original, processed, u.v[0].x * coverage);
}
