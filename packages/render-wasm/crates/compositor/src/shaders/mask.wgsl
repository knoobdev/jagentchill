// Stage masks, last step: the combined coverage multiplies the layer alpha.
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

@group(0) @binding(0) var layer_texture: texture_2d<f32>;
@group(0) @binding(1) var layer_sampler: sampler;
@group(1) @binding(0) var coverage_texture: texture_2d<f32>;
@group(1) @binding(1) var coverage_sampler: sampler;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let layer = textureSampleLevel(layer_texture, layer_sampler, input.tex_coord, 0.0);
    let coverage = textureSampleLevel(coverage_texture, coverage_sampler, input.tex_coord, 0.0).r;
    return vec4f(layer.rgb, layer.a * coverage);
}
