struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// Stages opacity and blend: straight-alpha source-over with the blend function B(Cb, Cs) of the catalogue.
// v[0].x = mode code 0–16, v[0].y = layer opacity.
struct BlendUniforms {
    v: array<vec4f, 8>,
}

@group(0) @binding(0) var base_texture: texture_2d<f32>;
@group(0) @binding(1) var base_sampler: sampler;
@group(1) @binding(0) var layer_texture: texture_2d<f32>;
@group(1) @binding(1) var layer_sampler: sampler;
@group(2) @binding(0) var<uniform> uniforms: BlendUniforms;

fn clamp01(color: vec3f) -> vec3f {
    return clamp(color, vec3f(0.0), vec3f(1.0));
}

fn lum(c: vec3f) -> f32 {
    return dot(c, vec3f(0.3, 0.59, 0.11));
}

fn sat(c: vec3f) -> f32 {
    return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

fn clip_color(c: vec3f) -> vec3f {
    var result = c;
    let l = lum(result);
    let n = min(min(result.r, result.g), result.b);
    let x = max(max(result.r, result.g), result.b);
    if (n < 0.0) {
        result = l + ((result - l) * l) / (l - n);
    }
    if (x > 1.0) {
        result = l + ((result - l) * (1.0 - l)) / (x - l);
    }
    return result;
}

fn set_lum(c: vec3f, l: f32) -> vec3f {
    return clip_color(c + (l - lum(c)));
}

fn set_sat(color: vec3f, target_sat: f32) -> vec3f {
    var result = color;
    let max_value = max(max(result.r, result.g), result.b);
    let min_value = min(min(result.r, result.g), result.b);
    if (max_value <= min_value) {
        return vec3f(0.0);
    }
    let scale = target_sat / (max_value - min_value);
    result = (result - vec3f(min_value)) * scale;
    return result;
}

fn hard_light(base: vec3f, layer: vec3f) -> vec3f {
    let low = 2.0 * base * layer;
    let high = 1.0 - 2.0 * (1.0 - base) * (1.0 - layer);
    return select(low, high, layer >= vec3f(0.5));
}

fn soft_light_channel(base: f32, layer: f32) -> f32 {
    if (layer <= 0.5) {
        return base - (1.0 - 2.0 * layer) * base * (1.0 - base);
    }

    let d = select(
        ((16.0 * base - 12.0) * base + 4.0) * base,
        sqrt(base),
        base > 0.25,
    );
    return base + (2.0 * layer - 1.0) * (d - base);
}

fn soft_light(base: vec3f, layer: vec3f) -> vec3f {
    return vec3f(
        soft_light_channel(base.r, layer.r),
        soft_light_channel(base.g, layer.g),
        soft_light_channel(base.b, layer.b),
    );
}

// 0 if Cb = 0; else 1 if Cs = 1; else min(1, Cb / (1 − Cs)).
fn color_dodge(base: vec3f, layer: vec3f) -> vec3f {
    let dodged = select(
        min(vec3f(1.0), base / max(vec3f(0.0001), vec3f(1.0) - layer)),
        vec3f(1.0),
        layer >= vec3f(1.0),
    );
    return select(dodged, vec3f(0.0), base <= vec3f(0.0));
}

// 1 if Cb = 1; else 0 if Cs = 0; else 1 − min(1, (1 − Cb) / Cs).
fn color_burn(base: vec3f, layer: vec3f) -> vec3f {
    let burned = select(
        vec3f(1.0) - min(vec3f(1.0), (vec3f(1.0) - base) / max(vec3f(0.0001), layer)),
        vec3f(0.0),
        layer <= vec3f(0.0),
    );
    return select(burned, vec3f(1.0), base >= vec3f(1.0));
}

fn blend_rgb(base: vec3f, layer: vec3f, mode: u32) -> vec3f {
    switch mode {
        case 1u { return min(base, layer); }
        case 2u { return base * layer; }
        case 3u { return color_burn(base, layer); }
        case 4u { return max(base, layer); }
        case 5u { return 1.0 - (1.0 - base) * (1.0 - layer); }
        case 6u { return min(vec3f(1.0), base + layer); }
        case 7u { return color_dodge(base, layer); }
        case 8u { return select(
            2.0 * base * layer,
            1.0 - 2.0 * (1.0 - base) * (1.0 - layer),
            base >= vec3f(0.5),
        ); }
        case 9u { return soft_light(base, layer); }
        case 10u { return hard_light(base, layer); }
        case 11u { return abs(base - layer); }
        case 12u { return base + layer - 2.0 * base * layer; }
        case 13u { return set_lum(set_sat(layer, sat(base)), lum(base)); }
        case 14u { return set_lum(set_sat(base, sat(layer)), lum(base)); }
        case 15u { return set_lum(layer, lum(base)); }
        case 16u { return set_lum(base, lum(layer)); }
        default { return layer; }
    }
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let base = textureSampleLevel(base_texture, base_sampler, input.tex_coord, 0.0);
    let layer = textureSampleLevel(layer_texture, layer_sampler, input.tex_coord, 0.0);
    let mode = u32(uniforms.v[0].x + 0.5);
    let alpha_s = layer.a * uniforms.v[0].y;
    let alpha_b = base.a;

    let blended = clamp01(blend_rgb(base.rgb, layer.rgb, mode));
    let alpha_o = alpha_s + alpha_b * (1.0 - alpha_s);
    if (alpha_o <= 0.0) {
        return vec4f(0.0);
    }
    let rgb = (alpha_s * (1.0 - alpha_b) * layer.rgb + alpha_s * alpha_b * blended + (1.0 - alpha_s) * alpha_b * base.rgb) / alpha_o;
    return vec4f(clamp01(rgb), alpha_o);
}
