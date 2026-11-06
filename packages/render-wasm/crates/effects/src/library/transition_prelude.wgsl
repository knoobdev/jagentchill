// Transition shaders. `A` (outgoing) and `B` (incoming) are straight alpha textures; they are premultiplied on
// entry, every formula runs on premultiplied RGBA, and the result is un-premultiplied on exit. A section defines
// `fn transition(uv: vec2f, p: f32) -> vec4f`.
@group(0) @binding(0) var a_texture: texture_2d<f32>;
@group(0) @binding(1) var a_sampler: sampler;
@group(1) @binding(0) var b_texture: texture_2d<f32>;
@group(1) @binding(1) var b_sampler: sampler;
@group(2) @binding(0) var<uniform> u: Uniforms;

fn inside(uv: vec2f) -> bool { return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0; }
fn pm(c: vec4f) -> vec4f { return vec4f(c.rgb * c.a, c.a); }
// Samples outside an input are transparent black …
fn A(uv: vec2f) -> vec4f { return select(vec4f(0.0), pm(textureSampleLevel(a_texture, a_sampler, uv, 0.0)), inside(uv)); }
fn B(uv: vec2f) -> vec4f { return select(vec4f(0.0), pm(textureSampleLevel(b_texture, b_sampler, uv, 0.0)), inside(uv)); }
// … unless the catalogue row says clamp.
fn Bc(uv: vec2f) -> vec4f { return pm(textureSampleLevel(b_texture, b_sampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0)); }
// A colour the transition introduces has alpha max(A.a, B.a) of the pixel.
fn cover(uv: vec2f) -> f32 { return max(A(uv).a, B(uv).a); }
fn tint(rgb: vec3f, uv: vec2f) -> vec4f {
    let c = cover(uv);
    return vec4f(rgb * c, c);
}
fn over(top: vec4f, bottom: vec4f) -> vec4f { return top + bottom * (1.0 - top.a); }
// `B` weight of a wipe: 1 − soft(p', x) with the stretched progress p' = p (1 + 2w) − w.
fn wipe(x: f32, p: f32, w: f32) -> f32 {
    let stretched = p * (1.0 + 2.0 * w) - w;
    if (w <= 0.0) {
        return select(0.0, 1.0, x < stretched);
    }
    return 1.0 - smoothstep(stretched - w, stretched + w, x);
}
// The coordinate from the edge where incoming content enters (0) to the opposite edge (1).
fn along(uv: vec2f, dir: vec2f) -> f32 { return dot(uv - vec2f(0.5), dir) + 0.5; }
// Canvas extent in px along a direction4 vector.
fn span(dir: vec2f) -> f32 { return abs(dir.x) * R().x + abs(dir.y) * R().y; }
// Position along an angle normalised 0…1 over the canvas, 0 on the side where `B` enters.
fn along_angle(uv: vec2f, degrees: f32) -> f32 {
    let axis = vec2f(cos(radians(degrees)), sin(radians(degrees)));
    return dot(uv - vec2f(0.5), axis) / (abs(axis.x) + abs(axis.y)) + 0.5;
}
// Half diagonal of the canvas in px.
fn half_diagonal() -> f32 { return length(R()) * 0.5; }
fn dip(uv: vec2f, p: f32, hold: f32, rgb: vec3f) -> vec4f {
    let f = tint(rgb, uv);
    let ramp = (1.0 - hold) / 2.0;
    if (p < ramp) {
        return mix(A(uv), f, p / max(ramp, 0.000001));
    }
    if (p <= (1.0 + hold) / 2.0) {
        return f;
    }
    return mix(f, B(uv), (p - (1.0 + hold) / 2.0) / max(ramp, 0.000001));
}
// `push`: A translated by dir × p × canvas, B following edge to edge.
fn push(uv: vec2f, dir: vec2f, p: f32) -> vec4f { return A(uv - dir * p) + B(uv + dir * (1.0 - p)); }
