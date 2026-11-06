// Stage color-chain, steps 1–5 and the pointwise part of step 6, in floating point with no 8-bit step in between:
// LUT (tetrahedral) → basic → wheels → curves → HSL bands → fade and vignette.
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct Uniforms {
    v: array<vec4f, 16>,
}

@group(0) @binding(0) var layer_texture: texture_2d<f32>;
@group(0) @binding(1) var layer_sampler: sampler;
@group(1) @binding(0) var lut_texture: texture_2d<f32>;
@group(1) @binding(1) var lut_sampler: sampler;
@group(2) @binding(0) var curves_texture: texture_2d<f32>;
@group(2) @binding(1) var curves_sampler: sampler;
@group(3) @binding(0) var<uniform> u: Uniforms;

// v[0] = flags (lut, basic, wheels, curves); v[1] = (hsl, spatial, lutSize, lutIntensity)
// v[2..4] = basic: exposure, brightness, contrast, highlights | shadows, whites, blacks, temperature | tint, saturation, vibrance, hue°
// v[5] = lift rgb, v[6] = gamma rgb, v[7] = gain rgb
// v[8..13] = hsl: eight bands × (hue, saturation, lightness)
// v[14] = (fade, vignette, m00, m01); v[15] = (m10, m11, tx, ty): canvas uv → effect frame over its half diagonal.

fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn eotf(c: vec3f) -> vec3f {
    let low = c / 12.92;
    let high = pow((max(c, vec3f(0.0)) + 0.055) / 1.055, vec3f(2.4));
    return select(high, low, c <= vec3f(0.04045));
}

fn oetf(c: vec3f) -> vec3f {
    let low = c * 12.92;
    let high = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
    return select(high, low, c <= vec3f(0.0031308));
}

fn lut_at(r: i32, g: i32, b: i32, size: i32) -> vec3f {
    // Slices along blue are laid side by side: x = r + b × size, y = g.
    return textureLoad(lut_texture, vec2i(r + b * size, g), 0).rgb;
}

fn lut_sample(color: vec3f, size: i32) -> vec3f {
    let last = f32(size - 1);
    let position = clamp(color, vec3f(0.0), vec3f(1.0)) * last;
    let base = min(vec3i(floor(position)), vec3i(size - 2));
    let f = position - vec3f(base);
    let c000 = lut_at(base.x, base.y, base.z, size);
    let c111 = lut_at(base.x + 1, base.y + 1, base.z + 1, size);
    var first: vec3f;
    var second: vec3f;
    var w: vec3f;
    if (f.r >= f.g) {
        if (f.g >= f.b) {
            first = lut_at(base.x + 1, base.y, base.z, size); second = lut_at(base.x + 1, base.y + 1, base.z, size); w = vec3f(f.r, f.g, f.b);
        } else if (f.r >= f.b) {
            first = lut_at(base.x + 1, base.y, base.z, size); second = lut_at(base.x + 1, base.y, base.z + 1, size); w = vec3f(f.r, f.b, f.g);
        } else {
            first = lut_at(base.x, base.y, base.z + 1, size); second = lut_at(base.x + 1, base.y, base.z + 1, size); w = vec3f(f.b, f.r, f.g);
        }
    } else if (f.b >= f.g) {
        first = lut_at(base.x, base.y, base.z + 1, size); second = lut_at(base.x, base.y + 1, base.z + 1, size); w = vec3f(f.b, f.g, f.r);
    } else if (f.b >= f.r) {
        first = lut_at(base.x, base.y + 1, base.z, size); second = lut_at(base.x, base.y + 1, base.z + 1, size); w = vec3f(f.g, f.b, f.r);
    } else {
        first = lut_at(base.x, base.y + 1, base.z, size); second = lut_at(base.x + 1, base.y + 1, base.z, size); w = vec3f(f.g, f.r, f.b);
    }
    return (1.0 - w.x) * c000 + (w.x - w.y) * first + (w.y - w.z) * second + w.z * c111;
}

fn basic(input: vec3f) -> vec3f {
    var c = input;
    let exposure = u.v[2].x; let brightness = u.v[2].y; let contrast = u.v[2].z; let highlights = u.v[2].w;
    let shadows = u.v[3].x; let whites = u.v[3].y; let blacks = u.v[3].z; let temperature = u.v[3].w;
    let tint = u.v[4].x; let saturation = u.v[4].y; let vibrance = u.v[4].z; let hue = u.v[4].w;
    if (exposure != 0.0) { c = oetf(eotf(c) * pow(2.0, 2.0 * exposure)); }
    if (brightness != 0.0) { c = c + 0.25 * brightness * 4.0 * c * (1.0 - c); }
    if (contrast != 0.0) { c = 0.5 + (c - 0.5) * pow(2.0, contrast); }
    if (highlights != 0.0) { let l = luma(c); c = c + 0.25 * highlights * smoothstep(0.25, 0.75, l) * 4.0 * l * (1.0 - l); }
    if (shadows != 0.0) { let l = luma(c); c = c + 0.25 * shadows * (1.0 - smoothstep(0.25, 0.75, l)) * 4.0 * l * (1.0 - l); }
    if (whites != 0.0) { c = c * (1.0 + 0.2 * whites); }
    if (blacks != 0.0) { c = c + 0.2 * blacks * (1.0 - c); }
    if (temperature != 0.0) {
        let lin = eotf(c);
        let before = luma(lin);
        var moved = vec3f(lin.r * (1.0 + 0.3 * temperature), lin.g, lin.b * (1.0 - 0.3 * temperature));
        let after = luma(moved);
        if (after > 0.0) { moved = moved * (before / after); }
        c = oetf(moved);
    }
    if (tint != 0.0) {
        let lin = eotf(c);
        let before = luma(lin);
        var moved = vec3f(lin.r, lin.g * (1.0 - 0.3 * tint), lin.b);
        let after = luma(moved);
        if (after > 0.0) { moved = moved * (before / after); }
        c = oetf(moved);
    }
    if (saturation != 0.0) { let l = luma(c); c = l + (c - l) * (1.0 + saturation); }
    if (vibrance != 0.0) {
        let l = luma(c);
        let high = max(max(c.r, c.g), c.b);
        let low = min(min(c.r, c.g), c.b);
        let s = select(0.0, (high - low) / high, high > 0.0);
        c = l + (c - l) * (1.0 + vibrance * (1.0 - s));
    }
    if (hue != 0.0) {
        // Rotation of the chroma vector about the grey axis (Rodrigues, axis (1,1,1)/√3).
        let l = luma(c);
        let chroma = c - l;
        let angle = radians(hue);
        let k = vec3f(0.57735027);
        let rotated = chroma * cos(angle) + cross(k, chroma) * sin(angle) + k * dot(k, chroma) * (1.0 - cos(angle));
        c = l + rotated;
    }
    return c;
}

fn rgb_to_hsl(c: vec3f) -> vec3f {
    let high = max(max(c.r, c.g), c.b);
    let low = min(min(c.r, c.g), c.b);
    let l = (high + low) / 2.0;
    let d = high - low;
    if (d <= 0.0) { return vec3f(0.0, 0.0, l); }
    let s = d / max(1.0 - abs(2.0 * l - 1.0), 0.000001);
    var h: f32;
    if (high == c.r) { h = (c.g - c.b) / d; } else if (high == c.g) { h = 2.0 + (c.b - c.r) / d; } else { h = 4.0 + (c.r - c.g) / d; }
    h = h * 60.0;
    if (h < 0.0) { h = h + 360.0; }
    return vec3f(h, clamp(s, 0.0, 1.0), l);
}

fn hue_part(p: f32, q: f32, t_in: f32) -> f32 {
    var t = t_in;
    if (t < 0.0) { t = t + 1.0; }
    if (t > 1.0) { t = t - 1.0; }
    if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 0.5) { return q; }
    if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    return p;
}

fn hsl_to_rgb(hsl: vec3f) -> vec3f {
    let h = fract(hsl.x / 360.0);
    let s = hsl.y;
    let l = hsl.z;
    if (s <= 0.0) { return vec3f(l); }
    let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
    let p = 2.0 * l - q;
    return vec3f(hue_part(p, q, h + 1.0 / 3.0), hue_part(p, q, h), hue_part(p, q, h - 1.0 / 3.0));
}

fn band_value(index: i32) -> vec3f {
    // 24 floats packed from v[8]: band i occupies floats 3i … 3i + 2.
    let start = index * 3;
    return vec3f(u.v[8 + start / 4][start % 4], u.v[8 + (start + 1) / 4][(start + 1) % 4], u.v[8 + (start + 2) / 4][(start + 2) % 4]);
}

fn hsl_bands(c: vec3f) -> vec3f {
    let centres = array<f32, 8>(0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0);
    var hsl = rgb_to_hsl(clamp(c, vec3f(0.0), vec3f(1.0)));
    let gate = smoothstep(0.05, 0.15, hsl.y);
    if (gate <= 0.0) { return c; }
    var shift = 0.0;
    var saturation = 0.0;
    var lightness = 0.0;
    for (var index = 0; index < 8; index = index + 1) {
        let centre = centres[index];
        let next = centres[(index + 1) % 8];
        let previous = centres[(index + 7) % 8];
        // Signed angular distance from the band centre, in −180…180.
        var d = hsl.x - centre;
        if (d > 180.0) { d = d - 360.0; }
        if (d < -180.0) { d = d + 360.0; }
        var reach = next - centre;
        if (d < 0.0) { reach = centre - previous; }
        if (reach <= 0.0) { reach = reach + 360.0; }
        let distance = abs(d);
        if (distance < reach) {
            let w = 0.5 * (1.0 + cos(3.14159265 * distance / reach)) * gate;
            let band = band_value(index);
            shift = shift + band.x * 30.0 * w;
            saturation = saturation + band.y * w;
            lightness = lightness + 0.25 * band.z * w;
        }
    }
    hsl = vec3f(hsl.x + shift + 360.0, clamp(hsl.y * (1.0 + saturation), 0.0, 1.0), clamp(hsl.z + lightness, 0.0, 1.0));
    return hsl_to_rgb(hsl);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let source = textureSampleLevel(layer_texture, layer_sampler, input.tex_coord, 0.0);
    // These samplers are part of the bind groups of every pass; the tables themselves are read texel by texel.
    let unused = textureSampleLevel(lut_texture, lut_sampler, vec2f(0.0), 0.0).a + textureSampleLevel(curves_texture, curves_sampler, vec2f(0.0), 0.0).a;
    var c = source.rgb + vec3f(unused * 0.0);
    if (u.v[0].x > 0.5) {
        c = mix(c, lut_sample(c, i32(u.v[1].z + 0.5)), u.v[1].w);
    }
    if (u.v[0].y > 0.5) { c = basic(c); }
    if (u.v[0].z > 0.5) {
        let lifted = c + u.v[5].rgb * (1.0 - c);
        c = pow(clamp(u.v[7].rgb * lifted, vec3f(0.0), vec3f(1.0)), 1.0 / u.v[6].rgb);
    }
    if (u.v[0].w > 0.5) {
        // 256-entry tables: master in alpha, then the channel curves in r, g, b.
        let m = clamp(c, vec3f(0.0), vec3f(1.0)) * 255.0;
        let m0 = vec3i(floor(m));
        let m1 = min(m0 + vec3i(1), vec3i(255));
        let mf = m - vec3f(m0);
        let master = vec3f(
            mix(textureLoad(curves_texture, vec2i(m0.r, 0), 0).a, textureLoad(curves_texture, vec2i(m1.r, 0), 0).a, mf.r),
            mix(textureLoad(curves_texture, vec2i(m0.g, 0), 0).a, textureLoad(curves_texture, vec2i(m1.g, 0), 0).a, mf.g),
            mix(textureLoad(curves_texture, vec2i(m0.b, 0), 0).a, textureLoad(curves_texture, vec2i(m1.b, 0), 0).a, mf.b),
        );
        let p = clamp(master, vec3f(0.0), vec3f(1.0)) * 255.0;
        let p0 = vec3i(floor(p));
        let p1 = min(p0 + vec3i(1), vec3i(255));
        let pf = p - vec3f(p0);
        c = vec3f(
            mix(textureLoad(curves_texture, vec2i(p0.r, 0), 0).r, textureLoad(curves_texture, vec2i(p1.r, 0), 0).r, pf.r),
            mix(textureLoad(curves_texture, vec2i(p0.g, 0), 0).g, textureLoad(curves_texture, vec2i(p1.g, 0), 0).g, pf.g),
            mix(textureLoad(curves_texture, vec2i(p0.b, 0), 0).b, textureLoad(curves_texture, vec2i(p1.b, 0), 0).b, pf.b),
        );
    }
    if (u.v[1].x > 0.5) { c = hsl_bands(c); }
    if (u.v[1].y > 0.5) {
        let fade = u.v[14].x;
        let vignette = u.v[14].y;
        c = c * (1.0 - 0.25 * fade) + 0.25 * fade;
        // r: distance from the centre of the effect frame over its half diagonal. The two matrix rows map a canvas
        // uv to that frame, already divided by the half diagonal.
        let m = vec4f(u.v[14].z, u.v[14].w, u.v[15].x, u.v[15].y);
        let offset = u.v[15].zw;
        let r = length(vec2f(m.x * input.tex_coord.x + m.y * input.tex_coord.y + offset.x, m.z * input.tex_coord.x + m.w * input.tex_coord.y + offset.y));
        c = c * (1.0 + 0.6 * vignette * smoothstep(0.5, 1.0, r));
    }
    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), source.a);
}
