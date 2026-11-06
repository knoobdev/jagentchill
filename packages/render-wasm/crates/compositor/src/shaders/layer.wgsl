// Stages crop, flip and transform: draws the source into a canvas-size texture with inverse rotation and
// UV-bounds discard.
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct Uniforms {
    v: array<vec4f, 8>,
}

@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> u: Uniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let resolution = u.v[0].xy;
    let center = u.v[0].zw;
    let size = u.v[1].xy;
    let angle = u.v[1].z;
    let crop = u.v[2];
    let flip = u.v[3].xy;

    let pixel = input.tex_coord * resolution - center;
    let c = cos(angle);
    let s = sin(angle);
    let local = vec2f(pixel.x * c + pixel.y * s, -pixel.x * s + pixel.y * c);
    let uv = local / size + vec2f(0.5);
    let flipped = vec2f(select(uv.x, 1.0 - uv.x, flip.x > 0.5), select(uv.y, 1.0 - uv.y, flip.y > 0.5));
    // crop = (left, top, right, bottom) in source space.
    let sample_uv = vec2f(crop.x, crop.y) + flipped * vec2f(1.0 - crop.x - crop.z, 1.0 - crop.y - crop.w);
    let color = textureSampleLevel(source_texture, source_sampler, sample_uv, 0.0);
    let inside = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
    return select(vec4f(0.0), color, inside);
}
