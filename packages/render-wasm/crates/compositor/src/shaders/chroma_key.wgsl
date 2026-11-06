// Stage chroma-key. Chroma distance in BT.709 CbCr of the non-linear value; alpha and spill per the specification.
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct Uniforms {
    v: array<vec4f, 8>,
}

@group(0) @binding(0) var layer_texture: texture_2d<f32>;
@group(0) @binding(1) var layer_sampler: sampler;
@group(1) @binding(0) var<uniform> u: Uniforms;

fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn chroma(c: vec3f) -> vec2f {
    let y = luma(c);
    return vec2f((c.b - y) / 1.8556, (c.r - y) / 1.5748);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let color = textureSampleLevel(layer_texture, layer_sampler, input.tex_coord, 0.0);
    let key = u.v[0].rgb;
    let similarity = u.v[1].x;
    let smoothness = u.v[1].y;
    let shadow = u.v[1].z;
    let spill = u.v[1].w;

    let d = min(1.0, 2.0 * distance(chroma(color.rgb), chroma(key)));
    // A hard step at d > similarity when there is no smoothness.
    var a = select(0.0, 1.0, d > similarity);
    if (smoothness > 0.0) {
        a = smoothstep(similarity, similarity + smoothness, d);
    }
    let y = luma(color.rgb);
    let alpha = a + shadow * (1.0 - y) * (1.0 - a);
    let despill = spill * (1.0 - smoothstep(similarity, similarity + 2.0 * smoothness + 0.1, d));
    let rgb = select(color.rgb, mix(color.rgb, vec3f(y), despill), alpha > 0.0);
    return vec4f(rgb, color.a * alpha);
}
