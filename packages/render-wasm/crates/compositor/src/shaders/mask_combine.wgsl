// Stage masks, one step: folds a mask's coverage into the accumulator. mode 0 add, 1 subtract, 2 intersect, 3 exclude.
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct Uniforms {
    v: array<vec4f, 8>,
}

@group(0) @binding(0) var acc_texture: texture_2d<f32>;
@group(0) @binding(1) var acc_sampler: sampler;
@group(1) @binding(0) var mask_texture: texture_2d<f32>;
@group(1) @binding(1) var mask_sampler: sampler;
@group(2) @binding(0) var<uniform> u: Uniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let acc = textureSampleLevel(acc_texture, acc_sampler, input.tex_coord, 0.0).r;
    let m = textureSampleLevel(mask_texture, mask_sampler, input.tex_coord, 0.0).r;
    let mode = u.v[0].x;
    let opacity = u.v[0].y;
    let c = opacity * select(m, 1.0 - m, u.v[0].z > 0.5);
    var out = max(acc, c);
    if (mode > 2.5) {
        out = abs(acc - c);
    } else if (mode > 1.5) {
        out = min(acc, c);
    } else if (mode > 0.5) {
        out = acc * (1.0 - c);
    }
    return vec4f(out, out, out, 1.0);
}
