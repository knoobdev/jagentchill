// The effects of `visual-effects-filters/catalog.md` (the `blur` effect runs as `gaussian-blur` passes), the helper
// passes they are built from, and the spatial colour steps. A section starts with `//# <id> | <uniforms>`; a uniform
// is `name` (f32) or `name:N` (vecN) and is read as `u_name()`. A select arrives as the index of the chosen option,
// except left/right/up/down, which arrives as a unit vector.

//# directional-blur | intensity angle
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let reach = vec2f(cos(radians(u_angle())), sin(radians(u_angle()))) * u_intensity() * 2.0 * S();
    var sum = vec4f(0.0);
    for (var k = 0; k < 17; k++) {
        sum += src_offset(uv, reach * (f32(k) / 16.0 - 0.5));
    }
    return sum / 17.0;
}

//# radial-blur | intensity centerX centerY
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = centre_uv(u_centerX(), u_centerY());
    let v = (uv - c) * BOX();
    let arc = radians(u_intensity() * 0.3);
    var sum = vec4f(0.0);
    for (var k = 0; k < 24; k++) {
        sum += src(c + rot(v, arc * (f32(k) / 23.0 - 0.5)) / BOX());
    }
    return sum / 24.0;
}

//# zoom-blur | intensity centerX centerY
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = centre_uv(u_centerX(), u_centerY());
    let p = u_intensity() / 100.0;
    var sum = vec4f(0.0);
    for (var k = 0; k < 24; k++) {
        sum += src(c + (uv - c) * mix(1.0 - 0.5 * p, 1.0, f32(k) / 23.0));
    }
    return sum / 24.0;
}

//# tilt-shift | position width angle
// cur = the `full` Gaussian copy, aux = the `half` copy, orig = the input.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let normal = vec2f(-sin(radians(u_angle())), cos(radians(u_angle())));
    let d = abs(dot(centred(uv) / BOX().y, normal) - u_position() / 200.0);
    let m = smoothstep(u_width() / 200.0, u_width() / 200.0 + 0.25, d);
    let input_colour = orig_px(px);
    let half_blur = aux_px(px);
    if (m < 0.5) { return mix(input_colour, half_blur, 2.0 * m); }
    return mix(half_blur, cur_px(px), 2.0 * m - 1.0);
}

//# frosted-glass | intensity grain
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let at = uv * BOX();
    let cx = cell_index(at.x / (4.0 * S()));
    let cy = cell_index(at.y / (4.0 * S()));
    let jitter = vec2f(unit(hash3(1u, cx, cy)), unit(hash3(2u, cx, cy))) - vec2f(0.5);
    let colour = src_offset(uv, jitter * u_intensity() * 0.4 * S());
    let noise = (unit(hash3(3u, cell_index(at.x), cell_index(at.y))) * 2.0 - 1.0) * u_grain() * 0.1 / 100.0;
    return vec4f(clamp(colour.rgb + vec3f(noise), vec3f(0.0), vec3f(1.0)), colour.a);
}

//# mosaic | blockSize
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let cell = max(u_blockSize() * S(), 1.0);
    return src((floor(uv * BOX() / cell) + vec2f(0.5)) * cell / BOX());
}

//# fisheye | strength
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let v = centred(uv);
    let r = length(v) / half_diagonal();
    let k = u_strength() / 100.0 * 0.8;
    return src_clear(vec2f(0.5) + v * ((1.0 + k * r * r) / (1.0 + k)) / BOX());
}

//# wave | amplitude frequency speed direction
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let vertical = u_direction() > 0.5;
    let coordinate = select(uv.x, uv.y, vertical);
    let shift = u_amplitude() * 0.5 * S() * sin(TAU * (u_frequency() * coordinate + u_speed() * T()));
    return src_clear(uv + select(vec2f(0.0, shift), vec2f(shift, 0.0), vertical) / BOX());
}

//# ripple | amplitude wavelength speed centerX centerY
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let v = (uv - centre_uv(u_centerX(), u_centerY())) * BOX();
    let r = length(v);
    let shift = u_amplitude() * 0.3 * S() * sin(TAU * (r / (u_wavelength() * 4.0 * S()) - u_speed() * T()));
    return src_clear(uv + normalize(v + vec2f(0.00001)) * shift / BOX());
}

//# twirl | angle radius centerX centerY
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = centre_uv(u_centerX(), u_centerY());
    let v = (uv - c) * BOX();
    let limit = u_radius() / 100.0 * half_diagonal();
    let r = length(v);
    if (r >= limit) { return src_clear(uv); }
    let falloff = 1.0 - r / limit;
    return src_clear(c + rot(v, -radians(u_angle()) * falloff * falloff) / BOX());
}

//# bulge | strength radius centerX centerY
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = centre_uv(u_centerX(), u_centerY());
    let v = (uv - c) * BOX();
    let limit = u_radius() / 100.0 * half_diagonal();
    let r = length(v);
    if (r >= limit) { return src_clear(uv); }
    let q = r / limit;
    return src_clear(c + v * (1.0 - u_strength() / 100.0 * 0.6 * (1.0 - q * q)) / BOX());
}

//# mirror | mode offset
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let axis = 0.5 + u_offset() / 200.0;
    let mode = u_mode();
    var at = uv;
    // left-to-right, right-to-left, top-to-bottom, bottom-to-top, quad
    if (mode < 0.5) { if (at.x > axis) { at.x = 2.0 * axis - at.x; } }
    else if (mode < 1.5) { if (at.x < axis) { at.x = 2.0 * axis - at.x; } }
    else if (mode < 2.5) { if (at.y > axis) { at.y = 2.0 * axis - at.y; } }
    else if (mode < 3.5) { if (at.y < axis) { at.y = 2.0 * axis - at.y; } }
    else {
        if (at.x > axis) { at.x = 2.0 * axis - at.x; }
        if (at.y > axis) { at.y = 2.0 * axis - at.y; }
    }
    return src_clear(at);
}

//# kaleidoscope | segments rotation zoom
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let v = centred(uv);
    let wedge = TAU / max(u_segments(), 1.0);
    var turn = atan2(v.y, v.x);
    turn = turn - wedge * floor(turn / wedge);
    turn = min(turn, wedge - turn) + radians(u_rotation());
    let r = length(v) * 100.0 / max(u_zoom(), 1.0);
    return src_clear(vec2f(0.5) + r * vec2f(cos(turn), sin(turn)) / BOX());
}

//# shake | intensity frequency rotation seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let time = u_frequency() * T();
    let drift_px = (vec2f(vnoise1(u_seed(), time), vnoise1(u_seed() + 1.0, time)) * 2.0 - vec2f(1.0)) * u_intensity() * 0.4 * S();
    let turn = radians(u_rotation() * 0.03) * (vnoise1(u_seed() + 2.0, time) * 2.0 - 1.0);
    let zoom = 1.0 + u_intensity() / 1000.0;
    return src(vec2f(0.5) + rot(centred(uv) - drift_px, -turn) / zoom / BOX());
}

//# tile | rows columns
fn effect(uv: vec2f, px: vec2f) -> vec4f { return src_clear(fract(uv * vec2f(u_columns(), u_rows()))); }

//# posterize | levels
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    return vec4f(clamp(floor(c.rgb * u_levels()) / (u_levels() - 1.0), vec3f(0.0), vec3f(1.0)), c.a);
}

//# halftone | dotSize angle mode
// Coverage of the dot of a grid rotated by `degrees` about the frame centre; `channel` picks the ink.
fn dot_cover(uv: vec2f, cell: f32, degrees: f32, channel: i32) -> f32 {
    let g = rot(centred(uv), -radians(degrees)) / cell;
    let nearest = floor(g + vec2f(0.5));
    let colour = src(vec2f(0.5) + rot(nearest * cell, radians(degrees)) / BOX()).rgb;
    let k = 1.0 - max(max(colour.r, colour.g), colour.b);
    var ink = 1.0 - luma(colour);
    if (channel == 3) { ink = k; }
    else if (channel >= 0) {
        ink = 0.0;
        if (k < 1.0) { ink = (1.0 - colour[channel] - k) / (1.0 - k); }
    }
    let radius = 0.5 * cell * sqrt(sat(ink));
    return 1.0 - smoothstep(radius - 0.5, radius + 0.5, length(g - nearest) * cell);
}
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let cell = max(u_dotSize() * S(), 1.0);
    if (u_mode() < 0.5) {
        return vec4f(vec3f(1.0 - dot_cover(uv, cell, u_angle(), -1)), 1.0);
    }
    var paper = vec3f(1.0);
    paper *= mix(vec3f(1.0), vec3f(0.0, 0.682, 0.937), dot_cover(uv, cell, u_angle() + 15.0, 0));
    paper *= mix(vec3f(1.0), vec3f(0.925, 0.0, 0.549), dot_cover(uv, cell, u_angle() + 75.0, 1));
    paper *= mix(vec3f(1.0), vec3f(1.0, 0.949, 0.0), dot_cover(uv, cell, u_angle(), 2));
    paper *= mix(vec3f(1.0), vec3f(0.0), dot_cover(uv, cell, u_angle() + 45.0, 3));
    return vec4f(paper, 1.0);
}

//# sketch | edgeStrength paper
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let e = sat(sobel(uv, S()) * u_edgeStrength() / 25.0);
    let grey = (1.0 - e) * (1.0 - u_paper() * 0.3 / 100.0 * vnoise(0.0, uv * BOX(), 2.0 * S()));
    return vec4f(vec3f(grey), src(uv).a);
}

//# cartoon | edgeStrength levels
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let centre = src(uv);
    // Bilateral smoothing over a 5 × 5 neighbourhood of radius 4 × s px.
    var sum = vec3f(0.0);
    var weight = 0.0;
    for (var j = -2; j <= 2; j++) {
        for (var i = -2; i <= 2; i++) {
            let offset = vec2f(f32(i), f32(j));
            let c = src_offset(uv, offset * 2.0 * S()).rgb;
            let difference = c - centre.rgb;
            let w = exp(-dot(offset, offset) / 4.0) * exp(-dot(difference, difference) / 0.02);
            sum += c * w;
            weight += w;
        }
    }
    let flattened = clamp(floor(sum / weight * u_levels()) / (u_levels() - 1.0), vec3f(0.0), vec3f(1.0));
    return vec4f(flattened * (1.0 - smoothstep(0.2, 0.6, sobel(uv, S()) * u_edgeStrength() / 50.0)), centre.a);
}

//# emboss | strength angle
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let d = vec2f(cos(radians(u_angle())), sin(radians(u_angle()))) * S();
    let relief = 0.5 + (luma(src_offset(uv, d).rgb) - luma(src_offset(uv, -d).rgb)) * u_strength() / 25.0;
    return vec4f(vec3f(sat(relief)), src(uv).a);
}

//# neon-edges-edge | threshold color:3
// The edge image: Sobel edges above the threshold in `color`, over black.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let magnitude = sobel(uv, S());
    let edge = sat(magnitude) * step(u_threshold() / 100.0, magnitude);
    return vec4f(u_color() * edge, src(uv).a);
}

//# neon-edges | blurred
// cur = the Gaussian of the edge image (when `blurred`), aux = the edge image.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let edges = aux_px(px);
    return vec4f(min(edges.rgb + cur_px(px).rgb * u_blurred(), vec3f(1.0)), edges.a);
}

//# duotone | shadowColor:3 highlightColor:3 intensity
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    return vec4f(mix(c.rgb, mix(u_shadowColor(), u_highlightColor(), luma(c.rgb)), u_intensity() / 100.0), c.a);
}

//# invert | intensity
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    return vec4f(mix(c.rgb, vec3f(1.0) - c.rgb, u_intensity() / 100.0), c.a);
}

//# threshold | level softness
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    let level = u_level() / 100.0;
    let w = u_softness() / 200.0;
    let l = luma(c.rgb);
    return vec4f(vec3f(select(step(level, l), smoothstep(level - w, level + w, l), w > 0.0)), c.a);
}

//# bright-pass | threshold
// What is brighter than the threshold (0…1), with the colour kept: rgb × max(luma − threshold, 0) / luma.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    let l = luma(c.rgb);
    return vec4f(c.rgb * max(l - u_threshold(), 0.0) / max(l, 0.0001), c.a);
}

//# glow | intensity
// cur = the Gaussian of the bright-pass; added to the input × intensity / 50.
fn effect(uv: vec2f, px: vec2f) -> vec4f { return add_light(orig_px(px), cur_px(px).rgb * u_intensity() / 50.0); }

//# light-leak | intensity color:3 position speed seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let cx = 0.5 + u_position() / 200.0 + 0.2 * sin(0.3 * u_speed() * T() + TAU * rand(u_seed(), 0u));
    let across = (uv.x - cx) / 0.30;
    let g = exp(-across * across) * (0.75 + 0.25 * cos(PI * (uv.y - 0.5)));
    return add_light(src(uv), u_color() * u_intensity() / 100.0 * g);
}

//# lens-flare | intensity positionX positionY color:3
fn ghost(at: vec2f, centre: vec2f, radius: f32, peak: f32) -> f32 {
    return peak * (1.0 - smoothstep(0.8 * radius, radius, length(at - centre)));
}
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let d = half_diagonal();
    let x = centred(uv);
    let source = vec2f(u_positionX(), u_positionY()) / 200.0 * BOX();
    let offset = x - source;
    let core_distance = length(offset) / (0.06 * d);
    var light = exp(-core_distance * core_distance);
    light += exp(-pow(offset.y / (0.008 * d), 2.0)) * exp(-pow(offset.x / (0.6 * d), 2.0));
    light += ghost(x, source * (1.0 - 0.5), 0.03 * d, 0.35);
    light += ghost(x, source * (1.0 - 1.0), 0.05 * d, 0.25);
    light += ghost(x, source * (1.0 - 1.4), 0.08 * d, 0.20);
    light += ghost(x, source * (1.0 - 1.8), 0.12 * d, 0.15);
    return add_light(src(uv), u_color() * u_intensity() / 100.0 * light);
}

//# light-rays | intensity length centerX centerY
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = centre_uv(u_centerX(), u_centerY());
    let toward = (c - uv) * BOX();
    let reach = min(u_length() / 100.0 * half_diagonal(), length(toward));
    let direction = normalize(toward + vec2f(0.00001));
    var sum = vec3f(0.0);
    for (var k = 0; k < 32; k++) {
        let tap = src_offset(uv, direction * reach * f32(k) / 31.0);
        let l = luma(tap.rgb);
        sum += tap.rgb * tap.a * max(l - 0.6, 0.0) / max(l, 0.0001);
    }
    return add_light(src(uv), sum / 32.0 * u_intensity() / 50.0);
}

//# strobe | frequency intensity color:3
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let on = fract(u_frequency() * T()) < 0.5;
    return add_light(src(uv), u_color() * select(0.0, u_intensity() / 100.0, on));
}

//# spotlight | radius softness darkness centerX centerY
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    let r = length((uv - centre_uv(u_centerX(), u_centerY())) * BOX()) / half_diagonal();
    let inner = u_radius() / 100.0;
    let outer = inner * (1.0 + u_softness() / 50.0);
    let shade = select(step(inner, r), smoothstep(inner, outer, r), outer > inner);
    return vec4f(c.rgb * (1.0 - u_darkness() / 100.0 * shade), c.a);
}

//# rgb-split | amount angle
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let d = vec2f(cos(radians(u_angle())), sin(radians(u_angle()))) * u_amount() * 0.2 * S();
    let c = src(uv);
    return vec4f(src_offset(uv, d).r, c.g, src_offset(uv, -d).b, c.a);
}

//# glitch | intensity blockSize speed seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let step_index = cell_index(u_speed() * 4.0 * T());
    let band = cell_index(uv.y * BOX().y / (u_blockSize() * 2.0 * S()));
    var shift = 0.0;
    var split = 0.0;
    if (rand2(u_seed(), band, step_index) < u_intensity() / 100.0) {
        shift = select(-1.0, 1.0, rand2(u_seed() + 1.0, band, step_index) < 0.5) * u_intensity() * 0.6 * S();
        split = 2.0 * S();
    }
    let c = src_offset(uv, vec2f(shift, 0.0));
    return vec4f(src_offset(uv, vec2f(shift + split, 0.0)).r, c.g, src_offset(uv, vec2f(shift - split, 0.0)).b, c.a);
}

//# scan-jitter | amount speed seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let row = cell_index(uv.y * BOX().y / max(S(), 0.0001));
    let shift = u_amount() * 0.3 * S() * (rand2(u_seed(), row, cell_index(u_speed() * 8.0 * T())) - 0.5);
    return src_offset(uv, vec2f(shift, 0.0));
}

//# signal-loss | intensity bandHeight speed seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    let top = fract(rand(u_seed(), 0u) + u_speed() * 0.1 * T());
    if (fract(uv.y - top) >= u_bandHeight() / 100.0) { return c; }
    let at = uv * BOX();
    let noise = unit(hash3(hash2(u32(max(u_seed(), 0.0)), FRAME()), cell_index(at.x), cell_index(at.y)));
    return vec4f(mix(c.rgb, vec3f(noise), u_intensity() / 100.0), c.a);
}

//# pixel-sort | threshold length direction
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    var best = c;
    var best_luma = luma(c.rgb);
    if (best_luma <= u_threshold() / 100.0) { return c; }
    let reach = u_length() * 2.0 * S();
    let axis = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), u_direction() > 0.5);
    for (var k = 1; k <= 32; k++) {
        let tap = src_offset(uv, axis * reach * f32(k) / 32.0);
        let l = luma(tap.rgb);
        if (l > best_luma) { best = tap; best_luma = l; }
    }
    return vec4f(best.rgb, c.a);
}

//# vhs | tracking chromaBleed noise scanlines seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let at = uv * BOX();
    // The tracking band sits near the bottom and drifts with time.
    let band_centre = 0.9 + 0.05 * sin(TAU * (0.2 * T() + rand(u_seed(), 0u)));
    let in_band = 1.0 - sat(abs(uv.y - band_centre) / 0.04);
    let shifted = uv + vec2f(u_tracking() * 0.2 * S() * in_band, 0.0) / BOX();
    let centre = src(shifted);
    let bleed = u_chromaBleed() * 0.1 * S();
    var chroma = vec3f(0.0);
    for (var k = -2; k <= 2; k++) {
        let tap = src_offset(shifted, vec2f(bleed * f32(k) / 2.0, 0.0)).rgb;
        chroma += tap - vec3f(luma(tap));
    }
    var colour = vec3f(luma(centre.rgb)) + chroma / 5.0;
    let frame_seed = hash2(u32(max(u_seed(), 0.0)), FRAME());
    colour += vec3f((unit(hash3(frame_seed, cell_index(at.x), cell_index(at.y))) * 2.0 - 1.0) * u_noise() * 0.15 / 100.0);
    let row = floor(at.y / max(S(), 1.0));
    if (fract(row * 0.5) >= 0.5) { colour *= 1.0 - u_scanlines() * 0.3 / 100.0; }
    return vec4f(clamp(colour, vec3f(0.0), vec3f(1.0)), centre.a);
}

//# crt | curvature scanlines vignette
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let v = centred(uv);
    let r = length(v) / half_diagonal();
    let warped = vec2f(0.5) + v * (1.0 + u_curvature() / 100.0 * 0.25 * r * r) / BOX();
    // Black outside the tube.
    if (!inside(warped)) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    let c = src(warped);
    var colour = c.rgb;
    let at = warped * BOX();
    // Aperture mask of period 3 × s px: each stripe keeps its own channel and dims the other two to 80 %.
    let stripe = i32(floor(at.x / max(S(), 1.0))) % 3;
    var mask = vec3f(0.8);
    mask[stripe] = 1.0;
    colour *= mask;
    if (fract(floor(at.y / max(S(), 1.0)) * 0.5) >= 0.5) { colour *= 1.0 - u_scanlines() * 0.4 / 100.0; }
    colour *= 1.0 - u_vignette() / 100.0 * r * r;
    return vec4f(colour, c.a);
}

//# film-grain | amount size monochrome seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    let at = uv * BOX();
    let amplitude = u_amount() * 0.2 / 100.0;
    var noise = vec3f(grain(at, u_size() * S(), u_seed(), 0u));
    if (u_monochrome() < 0.5) {
        noise = vec3f(noise.x, grain(at, u_size() * S(), u_seed(), 1u), grain(at, u_size() * S(), u_seed(), 2u));
    }
    return vec4f(clamp(c.rgb + noise * amplitude, vec3f(0.0), vec3f(1.0)), c.a);
}

//# old-film | scratches flicker sepia grain seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    let at = uv * BOX();
    var colour = mix(c.rgb, luma(c.rgb) * vec3f(1.00, 0.86, 0.62), u_sepia() / 100.0);
    colour *= 1.0 + (2.0 * rand(u_seed(), FRAME()) - 1.0) * u_flicker() * 0.15 / 100.0;
    let count = u32(floor(u_scratches() / 20.0));
    let width = max(1.0, S());
    for (var i = 0u; i < count; i++) {
        let column = rand(u_seed(), FRAME() * 8u + i + 1u) * BOX().x;
        if (abs(at.x - column) < width * 0.5) { colour += vec3f(0.35); }
    }
    colour += vec3f(grain(at, 2.0 * S(), u_seed(), 0u)) * u_grain() * 0.2 / 100.0;
    return vec4f(clamp(colour, vec3f(0.0), vec3f(1.0)), c.a);
}

//# super8 | borderSize jitter warmth seed
fn eotf(c: vec3f) -> vec3f {
    return select(pow((max(c, vec3f(0.0)) + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045));
}
fn oetf(c: vec3f) -> vec3f {
    return select(1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let short_side = min(BOX().x, BOX().y);
    let inset = u_borderSize() * 0.15 / 100.0 * short_side;
    let radius = 0.04 * short_side;
    // Signed distance to the rounded rectangle of the gate.
    let q = abs(centred(uv)) - (BOX() * 0.5 - vec2f(inset) - vec2f(radius));
    let distance = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
    if (distance > 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    let weave = u_jitter() * 0.01 / 100.0 * (2.0 * vnoise1(u_seed(), 18.0 * T()) - 1.0);
    let c = src(uv + vec2f(0.0, weave));
    // The Temperature formula of the basic sliders at slider value warmth × 0.4.
    let p = u_warmth() * 0.4 / 100.0;
    let lin = eotf(c.rgb);
    var moved = vec3f(lin.r * (1.0 + 0.3 * p), lin.g, lin.b * (1.0 - 0.3 * p));
    let after = luma(moved);
    if (after > 0.0) { moved *= luma(lin) / after; }
    return vec4f(clamp(oetf(moved), vec3f(0.0), vec3f(1.0)), c.a);
}

//# bit-crush | pixelSize colors
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let cell = max(u_pixelSize() * S(), 1.0);
    let c = src((floor(uv * BOX() / cell) + vec2f(0.5)) * cell / BOX());
    let levels = max(round(pow(u_colors(), 1.0 / 3.0)), 2.0);
    return vec4f(clamp(floor(c.rgb * levels) / (levels - 1.0), vec3f(0.0), vec3f(1.0)), c.a);
}

//# snow | density size speed wind seed
// One depth layer: `count` flakes, flake i living in column strip i so that a pixel meets only its neighbours.
fn snow_layer(uv: vec2f, count: f32, radius: f32, layer: u32) -> f32 {
    let seed = u_seed() + f32(layer) * 3.0;
    let fall = u_speed() * 0.1 * T() * (0.6 + 0.4 * f32(3u - layer) / 3.0);
    let drift = u_wind() / 100.0 * fall;
    let x = uv.x - drift;
    let reach = radius / BOX().x;
    let first = i32(floor((x - reach) * count));
    let last = i32(floor((x + reach) * count));
    var light = 0.0;
    for (var strip = first; strip <= min(last, first + 64); strip++) {
        let i = u32(strip - i32(floor(f32(strip) / count)) * i32(count));
        let at = vec2f((f32(strip) + rand(seed, 2u * i)) / count + drift, fract(rand(seed, 2u * i + 1u) + fall));
        let d = length((uv - at) * BOX());
        light = max(light, 1.0 - smoothstep(0.0, radius, d));
        // The flake that wraps over the bottom edge.
        let wrapped = length((uv - at + vec2f(0.0, 1.0)) * BOX());
        light = max(light, 1.0 - smoothstep(0.0, radius, wrapped));
    }
    return light;
}
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let total = u_density() * 4.0;
    let radius = u_size() * S();
    var light = 0.0;
    if (total >= 3.0) {
        let each = floor(total / 3.0);
        light = snow_layer(uv, each, radius, 0u);
        light = max(light, snow_layer(uv, each, radius * 0.7, 1u));
        light = max(light, snow_layer(uv, total - 2.0 * each, radius * 0.4, 2u));
    }
    return add_light(src(uv), vec3f(light));
}

//# rain | density length speed angle opacity seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let count = u_density() * 6.0;
    var light = 0.0;
    if (count >= 1.0) {
        let slant = vec2f(sin(radians(u_angle())), cos(radians(u_angle())));
        let length_px = u_length() * S();
        let fall = u_speed() * 0.3 * T();
        let at = uv * BOX();
        let reach = (abs(slant.x) * length_px + 2.0 * S()) / BOX().x;
        let first = i32(floor((uv.x - reach) * count));
        let last = i32(floor((uv.x + reach) * count));
        for (var strip = first; strip <= min(last, first + 64); strip++) {
            let i = u32(strip - i32(floor(f32(strip) / count)) * i32(count));
            let head_x = (f32(strip) + rand(u_seed(), 2u * i)) / count * BOX().x;
            let head_y = fract(rand(u_seed(), 2u * i + 1u) + fall) * (BOX().y + length_px);
            // Distance to the streak: the segment from its head back along the slant.
            let rel = at - vec2f(head_x, head_y);
            let t = clamp(-dot(rel, slant), 0.0, length_px);
            light = max(light, 1.0 - smoothstep(0.5 * S(), 1.5 * S(), length(rel + slant * t)));
        }
    }
    return add_light(src(uv), vec3f(light * u_opacity() / 100.0));
}

//# sparkles | density size twinkleSpeed color:3 seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let count = u32(u_density() * 2.0);
    let radius = u_size() * S();
    var light = 0.0;
    for (var i = 0u; i < count; i++) {
        let d = abs((uv - vec2f(rand(u_seed(), 3u * i), rand(u_seed(), 3u * i + 1u))) * BOX()) / radius;
        if (d.x < 1.0 && d.y < 1.0) {
            // A four-point star: the astroid |x|^½ + |y|^½ = 1.
            let shape = sat(1.0 - (sqrt(d.x) + sqrt(d.y)));
            light = max(light, shape * abs(sin(PI * u_twinkleSpeed() * T() + TAU * rand(u_seed(), 3u * i + 2u))));
        }
    }
    return add_light(src(uv), u_color() * light);
}

//# bokeh | density size speed color:3 seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let count = u32(u_density());
    let radius = u_size() * S();
    var light = 0.0;
    for (var i = 0u; i < count; i++) {
        let x = rand(u_seed(), 2u * i) + 0.01 * sin(TAU * (0.1 * T() + rand(u_seed(), 1000u + i)));
        let y = fract(rand(u_seed(), 2u * i + 1u) - u_speed() * 0.02 * T());
        let d = length((uv - vec2f(x, y)) * BOX());
        light += 0.35 * (1.0 - smoothstep(0.85 * radius, radius, d));
    }
    return add_light(src(uv), u_color() * light);
}

//# confetti | density size speed seed
fn hue(i: u32) -> vec3f {
    let palette = array<vec3f, 6>(vec3f(1.0, 0.25, 0.3), vec3f(1.0, 0.75, 0.1), vec3f(0.2, 0.8, 0.4), vec3f(0.15, 0.6, 1.0), vec3f(0.6, 0.35, 1.0), vec3f(1.0, 0.4, 0.8));
    return palette[i % 6u];
}
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let count = u_density() * 3.0;
    var light = vec3f(0.0);
    if (count >= 1.0) {
        let size = u_size() * S();
        let fall = u_speed() * 0.1 * T();
        let reach = size / BOX().x;
        let first = i32(floor((uv.x - reach) * count));
        let last = i32(floor((uv.x + reach) * count));
        for (var strip = first; strip <= min(last, first + 64); strip++) {
            let i = u32(strip - i32(floor(f32(strip) / count)) * i32(count));
            let at = vec2f((f32(strip) + rand(u_seed(), 3u * i)) / count, fract(rand(u_seed(), 3u * i + 1u) + fall));
            let spin = TAU * rand(u_seed(), 3u * i + 2u);
            for (var wrap = 0.0; wrap < 2.0; wrap += 1.0) {
                // A rectangle size × 0.6 size, turning at 2π rand rad/s.
                let local = abs(rot((uv - at + vec2f(0.0, wrap)) * BOX(), -spin * T()));
                if (local.x < size * 0.5 && local.y < size * 0.3) { light = hue(i); }
            }
        }
    }
    return add_light(src(uv), light);
}

//# dust | density size speed seed
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let count = u32(u_density() * 3.0);
    let radius = u_size() * S();
    var light = 0.0;
    for (var i = 0u; i < count; i++) {
        let start = vec2f(rand(u_seed(), 2u * i), rand(u_seed(), 2u * i + 1u));
        // A fixed heading per mote, read from the noise field at its start position.
        let heading = TAU * vnoise(u_seed(), start * BOX(), 200.0 * S());
        let travel = u_speed() * 0.01 * T() * BOX().y;
        let at = fract(start + vec2f(cos(heading), sin(heading)) * travel / BOX());
        let d = length((uv - at) * BOX());
        light += 0.4 * (1.0 - smoothstep(0.7 * radius, radius, d));
    }
    return add_light(src(uv), vec3f(light));
}

//# vignette | amount size softness color:3
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    let r = length(centred(uv)) / half_diagonal();
    let inner = u_size() / 100.0;
    let w = u_softness() / 100.0;
    let shade = select(step(inner, r), smoothstep(inner, inner + w, r), w > 0.0);
    return vec4f(mix(c.rgb, u_color(), u_amount() / 100.0 * shade), c.a);
}

//# chromatic-aberration | amount
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let v = uv - vec2f(0.5);
    let k = u_amount() * 0.0006;
    let c = src(uv);
    return vec4f(src(vec2f(0.5) + v * (1.0 + k)).r, c.g, src(vec2f(0.5) + v * (1.0 - k)).b, c.a);
}

//# lens-distortion | barrel chromatic autoFit
fn distorted(uv: vec2f, k: f32, fit: bool) -> vec4f {
    let v = centred(uv);
    let r = length(v) / half_diagonal();
    var scale = 1.0 + k * r * r;
    if (fit) { scale = scale / (1.0 + max(k, 0.0)) / (1.0 + max(-k, 0.0) * 0.5); }
    return src_clear(vec2f(0.5) + v * scale / BOX());
}
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let k = u_barrel() / 100.0 * 0.4;
    let fringe = u_chromatic() / 100.0 * 0.15;
    let fit = u_autoFit() > 0.5;
    let green = distorted(uv, k, fit);
    return vec4f(distorted(uv, k * (1.0 + fringe), fit).r, green.g, distorted(uv, k * (1.0 - fringe), fit).b, green.a);
}

//# letterbox | ratio color:3
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let ratios = array<f32, 4>(1.85, 2.00, 2.35, 2.76);
    let band = BOX().x / ratios[i32(clamp(u_ratio(), 0.0, 3.0) + 0.5)];
    if (band < BOX().y && abs(uv.y - 0.5) * BOX().y > band * 0.5) { return vec4f(u_color(), 1.0); }
    return src(uv);
}

//# lens-zoom | amount centerX centerY
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = centre_uv(u_centerX(), u_centerY());
    return src_clear(c + (uv - c) * 100.0 / max(u_amount(), 1.0));
}

//# slow-zoom | startScale endScale centerX centerY
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = centre_uv(u_centerX(), u_centerY());
    return src_clear(c + (uv - c) * 100.0 / max(mix(u_startScale(), u_endScale(), PROGRESS()), 1.0));
}

//# pan-drift | direction:2 distance
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let travel = u_direction() * mix(-0.5, 0.5, PROGRESS()) * u_distance() / 100.0;
    return src_clear(vec2f(0.5) + (uv - vec2f(0.5) - travel) / (1.0 + u_distance() / 100.0));
}

//# photo-frame | borderSize tilt color:3
// erf by Abramowitz and Stegun 7.1.26.
fn erf(x: f32) -> f32 {
    let t = 1.0 / (1.0 + 0.3275911 * abs(x));
    let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
    return select(y, -y, x < 0.0);
}
// A unit box of half size `h` blurred by a Gaussian of `sigma`, along one axis.
fn soft_span(x: f32, h: f32, sigma: f32) -> f32 {
    let k = 1.0 / (sigma * 1.41421356);
    return 0.5 * (erf((x + h) * k) - erf((x - h) * k));
}
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let tilt = radians(u_tilt());
    let half_box = BOX() * 0.5;
    let q = rot(centred(uv), -tilt);
    if (abs(q.x) <= half_box.x && abs(q.y) <= half_box.y) {
        // On the card: the picture, scaled and moved up, on the border colour.
        let scale = 1.0 - u_borderSize() * 0.004;
        let picture = (q + vec2f(0.0, u_borderSize() * 0.001 * BOX().y)) / max(scale, 0.0001);
        if (abs(picture.x) <= half_box.x && abs(picture.y) <= half_box.y) {
            let c = src(vec2f(0.5) + picture / BOX());
            return vec4f(mix(u_color(), c.rgb, c.a), 1.0);
        }
        return vec4f(u_color(), 1.0);
    }
    // Under the card: its shadow, offset 8 × s px down, sigma 8 × s px, 30 % black.
    let s = rot(centred(uv) - vec2f(0.0, 8.0 * S()), -tilt);
    return vec4f(0.0, 0.0, 0.0, 0.3 * soft_span(s.x, half_box.x, 8.0 * S()) * soft_span(s.y, half_box.y, 8.0 * S()));
}

//# matte-upsample | matteSize:2
// cur = the person matte drawn through the layer's transform, orig = the picture. Joint bilateral upsampling guided
// by luma: spatial radius 4 matte pixels, range sigma 0.1.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let texel = BOX() / max(u_matteSize(), vec2f(1.0));
    let guide = luma(orig_px(px).rgb);
    var sum = 0.0;
    var weight = 0.0;
    for (var j = -4; j <= 4; j++) {
        for (var i = -4; i <= 4; i++) {
            let offset = vec2f(f32(i), f32(j));
            let at = to_px(edge_uv(uv + offset * texel / BOX()));
            let difference = luma(orig_px(at).rgb) - guide;
            let w = exp(-dot(offset, offset) / 8.0) * exp(-difference * difference / 0.02);
            sum += cur_px(at).r * w;
            weight += w;
        }
    }
    return vec4f(vec3f(sum / max(weight, 0.0001)), 1.0);
}

//# matte-copy |
// The person matte as a grey picture, for the passes that blur it. aux = the matte.
fn effect(uv: vec2f, px: vec2f) -> vec4f { return vec4f(vec3f(aux_px(px).r), 1.0); }

//# body-outline-stroke | width color:3
// The stroke centred on the 0.5 iso-line of the matte: a pixel is on it when the other side of the line lies within
// half the width. aux = the matte.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let half_width = u_width() * S() * 0.5;
    let here = aux_at(uv).r >= 0.5;
    var nearest = half_width + 1.0;
    for (var ring = 1; ring <= 8; ring++) {
        let radius = half_width * f32(ring) / 8.0;
        for (var k = 0; k < 16; k++) {
            let turn = TAU * (f32(k) + 0.5 * f32(ring % 2)) / 16.0;
            let other = aux_at(uv + vec2f(cos(turn), sin(turn)) * radius / BOX()).r >= 0.5;
            if (other != here) { nearest = min(nearest, radius); }
        }
    }
    let cover = 1.0 - smoothstep(half_width - 1.0, half_width, nearest);
    return vec4f(u_color() * cover, cover);
}

//# body-outline | blurred
// cur = the Gaussian of the stroke (when `blurred`), aux = the stroke: the stroke over the input, plus its glow.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let input_colour = orig_px(px);
    let stroke = aux_px(px);
    let glow = cur_px(px) * u_blurred();
    let colour = mix(input_colour.rgb, stroke.rgb / max(stroke.a, 0.0001), stroke.a) + glow.rgb;
    return vec4f(min(colour, vec3f(1.0)), max(input_colour.a, stroke.a));
}

//# body-glow | intensity color:3
// cur = the Gaussian of the matte, aux = the matte.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let halo = cur_px(px).r * (1.0 - aux_px(px).r);
    return add_light(orig_px(px), u_color() * halo * u_intensity() / 50.0);
}

//# background-blur |
// cur = the Gaussian of the input, aux = the matte.
fn effect(uv: vec2f, px: vec2f) -> vec4f { return mix(cur_px(px), orig_px(px), aux_px(px).r); }

//# background-mono | amount
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    let grey = mix(c.rgb, vec3f(luma(c.rgb)), u_amount() / 100.0);
    return vec4f(mix(grey, c.rgb, aux_px(px).r), c.a);
}

//# body-echo | copies distance angle fade
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let input_colour = src(uv);
    let step_px = vec2f(cos(radians(u_angle())), sin(radians(u_angle()))) * u_distance() * S();
    var colour = input_colour.rgb;
    // Farthest copy first.
    for (var k = i32(u_copies()); k >= 1; k--) {
        let at = uv - step_px * f32(k) / BOX();
        if (inside(at)) {
            let copy = src(at);
            colour = mix(colour, copy.rgb, aux_at(at).r * copy.a * pow(1.0 - u_fade() / 100.0, f32(k)));
        }
    }
    return vec4f(mix(colour, input_colour.rgb, aux_px(px).r), input_colour.a);
}

//# color-sharpen | amount
// Unsharp mask: v + 2p (v − gauss(v, sigma 1.5 × s px)). cur = the Gaussian, orig = the picture.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = orig_px(px);
    return vec4f(c.rgb + 2.0 * u_amount() * (c.rgb - cur_px(px).rgb), c.a);
}

//# color-clarity | amount
// Local contrast: v + p (v − gauss(v, sigma 40 × s px)) × 4L(1 − L). cur = the Gaussian, orig = the picture.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = orig_px(px);
    let l = luma(c.rgb);
    return vec4f(c.rgb + u_amount() * (c.rgb - cur_px(px).rgb) * 4.0 * l * (1.0 - l), c.a);
}

//# color-grain | amount
// Monochrome Gaussian noise of standard deviation 0.12p on cells of 1.5 × s px, from hash(frameIndex, cellX, cellY).
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = src(uv);
    let at = uv * BOX() / (1.5 * S());
    let h = hash3(FRAME(), cell_index(at.x), cell_index(at.y));
    return vec4f(clamp(c.rgb + vec3f(gauss(h, pcg(h)) * 0.12 * u_amount()), vec3f(0.0), vec3f(1.0)), c.a);
}

//# frame-blend | mix
// cur = a source frame, aux = the next one, both placed by the layer's transform.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let a = cur_px(px);
    let b = aux_px(px);
    let alpha = mix(a.a, b.a, u_mix());
    // Mixed on premultiplied colour, so a transparent frame adds no colour of its own.
    let colour = mix(a.rgb * a.a, b.rgb * b.a, u_mix());
    return vec4f(colour / max(alpha, 0.0001), alpha);
}

//# matte-view |
// The alpha a key left, as greyscale: white kept, black removed.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let a = cur_px(px).a;
    return vec4f(a, a, a, 1.0);
}

//# wipe-reveal | reveal angle softness
// The clip-animation reveal: a linear wipe across the element box along `angle` (0 = left to right), `softness`
// of the box wide. `reveal` 0 hides the layer and 1 shows all of it.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let c = cur_px(px);
    let direction = vec2f(cos(radians(u_angle())), sin(radians(u_angle())));
    let along = dot(uv - vec2f(0.5), direction) / max(abs(direction.x) + abs(direction.y), 0.0001) + 0.5;
    let edge = u_reveal() * (1.0 + u_softness()) - u_softness() * 0.5;
    let shown = 1.0 - smoothstep(edge - u_softness() * 0.5, edge + u_softness() * 0.5, along);
    return vec4f(c.rgb, c.a * shown);
}

//# motion-blur | current:4 previous:4 turn:2 samples
// The layer as drawn at the frame time (`current`: centre x, y, width, height in px; `turn.x` its rotation in
// radians) averaged with copies of itself under the transforms between `previous` (`turn.y`) and `current`.
fn effect(uv: vec2f, px: vec2f) -> vec4f {
    let n = i32(clamp(u_samples(), 2.0, 16.0));
    var sum = vec4f(0.0);
    for (var k = 0; k < 16; k++) {
        if (k >= n) { break; }
        let f = f32(k) / f32(n - 1);
        let box_k = mix(u_previous(), u_current(), f);
        let turn_k = mix(u_turn().y, u_turn().x, f);
        // The point of the element that copy k shows at this pixel, then where the layer texture holds it.
        let local = rot(px - box_k.xy, -turn_k) / max(abs(box_k.zw), vec2f(0.0001));
        let c = cur_px(u_current().xy + rot(local * abs(u_current().zw), u_turn().x));
        sum += vec4f(c.rgb * c.a, c.a);
    }
    let alpha = sum.a / f32(n);
    return vec4f(sum.rgb / max(sum.a, 0.0001), alpha);
}
