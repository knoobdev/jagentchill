// Effect shaders. A pass reads `cur` (the previous pass, or the layer), `orig` (the layer as the effect received it)
// and `aux` (a stored pass or a named texture such as the person matte; `orig` when the pass names none). All are
// canvas-size, straight alpha. A section defines `fn effect(uv: vec2f, px: vec2f) -> vec4f` in the effect frame:
// `uv` 0…1 across the element box (the canvas for an effect layer), `px` the canvas pixel.
@group(0) @binding(0) var cur_texture: texture_2d<f32>;
@group(0) @binding(1) var cur_sampler: sampler;
@group(1) @binding(0) var orig_texture: texture_2d<f32>;
@group(1) @binding(1) var orig_sampler: sampler;
@group(2) @binding(0) var aux_texture: texture_2d<f32>;
@group(2) @binding(1) var aux_sampler: sampler;
@group(3) @binding(0) var<uniform> u: Uniforms;

fn inside(uv: vec2f) -> bool { return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0; }
// Canvas-pixel reads.
fn cur_px(px: vec2f) -> vec4f { return textureSampleLevel(cur_texture, cur_sampler, px / R(), 0.0); }
fn orig_px(px: vec2f) -> vec4f { return textureSampleLevel(orig_texture, orig_sampler, px / R(), 0.0); }
fn aux_px(px: vec2f) -> vec4f { return textureSampleLevel(aux_texture, aux_sampler, px / R(), 0.0); }
fn edge_uv(uv: vec2f) -> vec2f {
    let inset = vec2f(0.5) / max(BOX(), vec2f(1.0));
    return clamp(uv, inset, vec2f(1.0) - inset);
}
// Frame reads of the current input: the clamped edge texel outside the frame …
fn src(uv: vec2f) -> vec4f { return cur_px(to_px(edge_uv(uv))); }
// … or transparent black, for the remap effects.
fn src_clear(uv: vec2f) -> vec4f { return select(vec4f(0.0), cur_px(to_px(edge_uv(uv))), inside(uv)); }
fn orig_at(uv: vec2f) -> vec4f { return orig_px(to_px(edge_uv(uv))); }
fn aux_at(uv: vec2f) -> vec4f { return aux_px(to_px(edge_uv(uv))); }
// A frame read displaced by render-target pixels along the box axes.
fn src_offset(uv: vec2f, pixels: vec2f) -> vec4f { return src(uv + pixels / BOX()); }
// Frame position in px from the frame centre, along the box axes.
fn centred(uv: vec2f) -> vec2f { return (uv - vec2f(0.5)) * BOX(); }
fn half_diagonal() -> f32 { return length(BOX()) * 0.5; }
// `c`: (centerX, centerY) in −100…100 mapped to frame uv.
fn centre_uv(cx: f32, cy: f32) -> vec2f { return vec2f(0.5) + vec2f(cx, cy) / 200.0; }
// Light and particles are added to the straight colour, so they are weighted by the input alpha when composited.
fn add_light(base: vec4f, light: vec3f) -> vec4f { return vec4f(min(base.rgb + light, vec3f(1.0)), base.a); }
fn sobel(uv: vec2f, pixels: f32) -> f32 {
    let tl = luma(src_offset(uv, vec2f(-pixels, -pixels)).rgb);
    let tc = luma(src_offset(uv, vec2f(0.0, -pixels)).rgb);
    let tr = luma(src_offset(uv, vec2f(pixels, -pixels)).rgb);
    let ml = luma(src_offset(uv, vec2f(-pixels, 0.0)).rgb);
    let mr = luma(src_offset(uv, vec2f(pixels, 0.0)).rgb);
    let bl = luma(src_offset(uv, vec2f(-pixels, pixels)).rgb);
    let bc = luma(src_offset(uv, vec2f(0.0, pixels)).rgb);
    let br = luma(src_offset(uv, vec2f(pixels, pixels)).rgb);
    let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    let gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
    return length(vec2f(gx, gy));
}
// Gaussian grain of unit variance on cells of `size` px, a new pattern each frame.
fn grain(px: vec2f, size: f32, seed: f32, channel: u32) -> f32 {
    let frame_seed = hash2(u32(max(seed, 0.0)), FRAME());
    let cx = cell_index(px.x / max(size, 0.0001));
    let cy = cell_index(px.y / max(size, 0.0001));
    return gauss(hash3(frame_seed + channel, cx, cy), hash3(frame_seed + channel + 101u, cx, cy));
}
