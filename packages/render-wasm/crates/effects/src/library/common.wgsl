// Shared by every library shader (effects and transitions): the uniform block, the deterministic hash and noise.
//
// Uniform slots: v[0] = (target width, target height, pixel scale factor s, time t in seconds)
//                v[1] = (progress, frame index, 0, 0)
//                v[2], v[3] = rows of the matrix canvas pixel -> frame uv, with the frame size in px in .w
//                v[4], v[5] = rows of the matrix frame uv -> canvas pixel
//                v[6] ...   = the shader's own uniforms, one slot each, in the order of its declaration
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct Uniforms {
    v: array<vec4f, 16>,
}

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

fn R() -> vec2f { return u.v[0].xy; }
fn S() -> f32 { return u.v[0].z; }
fn T() -> f32 { return u.v[0].w; }
fn PROGRESS() -> f32 { return u.v[1].x; }
fn FRAME() -> u32 { return u32(max(u.v[1].y, 0.0)); }
fn BOX() -> vec2f { return vec2f(u.v[2].w, u.v[3].w); }
fn to_uv(px: vec2f) -> vec2f { return vec2f(dot(u.v[2].xyz, vec3f(px, 1.0)), dot(u.v[3].xyz, vec3f(px, 1.0))); }
fn to_px(uv: vec2f) -> vec2f { return vec2f(dot(u.v[4].xyz, vec3f(uv, 1.0)), dot(u.v[5].xyz, vec3f(uv, 1.0))); }

// The engine hash (render-engine "Deterministic hash"): 32-bit PCG output function, wrapping arithmetic.
fn pcg(x: u32) -> u32 {
    let s = x * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
fn hash2(seed: u32, i: u32) -> u32 { return pcg(pcg(seed) + i); }
fn hash3(seed: u32, i: u32, j: u32) -> u32 { return pcg(hash2(seed, i) + j); }
// A hash mapped to 0…1 (the top 24 bits, so that the value is exact in f32 and below 1).
fn unit(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }
fn cell_index(x: f32) -> u32 { return u32(i32(floor(x))); }
fn rand(seed: f32, i: u32) -> f32 { return unit(hash2(u32(max(seed, 0.0)), i)); }
fn rand2(seed: f32, i: u32, j: u32) -> f32 { return unit(hash3(u32(max(seed, 0.0)), i, j)); }

fn lattice(seed: u32, c: vec2f) -> f32 { return unit(hash3(seed, cell_index(c.x), cell_index(c.y))); }
// 2-D value noise on a lattice of `cell` (same unit as `x`), smoothstep interpolation, range 0…1.
fn vnoise(seed: f32, x: vec2f, cell: f32) -> f32 {
    let q = x / max(cell, 0.0001);
    let i = floor(q);
    let f = q - i;
    let w = f * f * (3.0 - 2.0 * f);
    let k = u32(max(seed, 0.0));
    let a = lattice(k, i);
    let b = lattice(k, i + vec2f(1.0, 0.0));
    let c = lattice(k, i + vec2f(0.0, 1.0));
    let d = lattice(k, i + vec2f(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
// 1-D value noise with unit cells.
fn vnoise1(seed: f32, x: f32) -> f32 {
    let i = floor(x);
    let f = x - i;
    let w = f * f * (3.0 - 2.0 * f);
    let k = u32(max(seed, 0.0));
    return mix(unit(hash2(k, cell_index(i))), unit(hash2(k, cell_index(i + 1.0))), w);
}
// A zero-mean, unit-variance value from two hashes (Box–Muller).
fn gauss(h1: u32, h2: u32) -> f32 {
    return sqrt(-2.0 * log(max(unit(h1), 0.0000001))) * cos(TAU * unit(h2));
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn rot(v: vec2f, a: f32) -> vec2f {
    let c = cos(a);
    let s = sin(a);
    return vec2f(v.x * c - v.y * s, v.x * s + v.y * c);
}
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
