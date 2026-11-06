// The 52 transitions of `transitions/catalog.md`. A section starts with `//# <id> | <uniforms>`; a uniform is
// `name` (f32) or `name:N` (vecN) and is read as `u_name()`. `direction4` arrives as the unit vector `dir`
// (left = content travels toward −x); other selects arrive as the index of the chosen option.

//# cross-dissolve |
fn transition(uv: vec2f, p: f32) -> vec4f { return mix(A(uv), B(uv), p); }

//# dip-to-black | hold
fn transition(uv: vec2f, p: f32) -> vec4f { return dip(uv, p, u_hold() / 100.0, vec3f(0.0)); }

//# dip-to-white | hold
fn transition(uv: vec2f, p: f32) -> vec4f { return dip(uv, p, u_hold() / 100.0, vec3f(1.0)); }

//# dip-to-color | color:3 hold
fn transition(uv: vec2f, p: f32) -> vec4f { return dip(uv, p, u_hold() / 100.0, u_color()); }

//# additive-dissolve |
fn transition(uv: vec2f, p: f32) -> vec4f { return min(vec4f(1.0), A(uv) * (1.0 - p) * (1.0 + p) + B(uv) * p * (2.0 - p)); }

//# linear-wipe | angle softness
fn transition(uv: vec2f, p: f32) -> vec4f { return mix(A(uv), B(uv), wipe(along_angle(uv, u_angle()), p, u_softness() / 200.0)); }

//# clock-wipe | direction startAngle softness
fn transition(uv: vec2f, p: f32) -> vec4f {
    let v = (uv - vec2f(0.5)) * R();
    // 0° = up, growing clockwise on screen.
    var turn = atan2(v.x, -v.y) - radians(u_startAngle());
    if (u_direction() > 0.5) { turn = -turn; }
    let x = fract(turn / TAU);
    return mix(A(uv), B(uv), wipe(x, p, u_softness() / 200.0));
}

//# barn-door | orientation mode softness
fn transition(uv: vec2f, p: f32) -> vec4f {
    let dn = select(abs(uv.x - 0.5), abs(uv.y - 0.5), u_orientation() > 0.5) * 2.0;
    let x = select(dn, 1.0 - dn, u_mode() > 0.5);
    return mix(A(uv), B(uv), wipe(x, p, u_softness() / 200.0));
}

//# slide | direction:2
fn transition(uv: vec2f, p: f32) -> vec4f { return over(B(uv + u_direction() * (1.0 - p)), A(uv)); }

//# push | direction:2
fn transition(uv: vec2f, p: f32) -> vec4f { return push(uv, u_direction(), p); }

//# cover | direction:2
fn transition(uv: vec2f, p: f32) -> vec4f {
    let dir = u_direction();
    // B's leading edge is at along = p; the shadow falls on A just ahead of it.
    let ahead = (along(uv, dir) - p) * span(dir) / (24.0 * S());
    let shade = 0.4 * (1.0 - sat(ahead)) * step(0.0, ahead);
    let a = A(uv);
    return over(B(uv + dir * (1.0 - p)), vec4f(a.rgb * (1.0 - shade), a.a));
}

//# uncover | direction:2
fn transition(uv: vec2f, p: f32) -> vec4f {
    let dir = u_direction();
    // A's trailing edge is at along = p; the shadow falls on B just behind it.
    let behind = (p - along(uv, dir)) * span(dir) / (24.0 * S());
    let shade = 0.4 * (1.0 - sat(behind)) * step(0.0, behind);
    let b = B(uv);
    return over(A(uv - dir * p), vec4f(b.rgb * (1.0 - shade), b.a));
}

//# elastic-slide | direction:2 bounce
fn spring(p: f32, damping: f32) -> f32 { return 1.0 - cos(4.5 * PI * p) * exp(-damping * p); }
fn transition(uv: vec2f, p: f32) -> vec4f {
    let damping = 6.0 - 4.0 * u_bounce() / 100.0;
    let q = clamp(spring(p, damping) / spring(1.0, damping), 0.0, 1.15);
    let dir = u_direction();
    if (q > 1.0) {
        // Overshoot: the strip left uncovered behind B shows B's edge texels.
        return Bc(uv + dir * (1.0 - q));
    }
    return push(uv, dir, q);
}

//# zoom-in | scale blur
fn zoomed(uv: vec2f, p: f32, scale_a: f32, scale_b: f32) -> vec4f {
    let v = uv - vec2f(0.5);
    let fade = sat((p - 0.4) / 0.2);
    return mix(A(vec2f(0.5) + v / scale_a), B(vec2f(0.5) + v / scale_b), fade);
}
fn zoom_blurred(uv: vec2f, p: f32, scale_a: f32, scale_b: f32, strength: f32) -> vec4f {
    var sum = vec4f(0.0);
    for (var k = 0; k < 16; k++) {
        let f = 1.0 - 0.5 * strength * f32(k) / 15.0;
        sum += zoomed(vec2f(0.5) + (uv - vec2f(0.5)) * f, p, scale_a, scale_b);
    }
    return sum / 16.0;
}
fn transition(uv: vec2f, p: f32) -> vec4f {
    let k = u_scale() / 100.0;
    return zoom_blurred(uv, p, mix(1.0, k, p), mix(1.0 / k, 1.0, p), u_blur() / 100.0 * sin(PI * p));
}

//# zoom-out | scale blur
fn zoomed(uv: vec2f, p: f32, scale_a: f32, scale_b: f32) -> vec4f {
    let v = uv - vec2f(0.5);
    let fade = sat((p - 0.4) / 0.2);
    return mix(A(vec2f(0.5) + v / scale_a), B(vec2f(0.5) + v / scale_b), fade);
}
fn zoom_blurred(uv: vec2f, p: f32, scale_a: f32, scale_b: f32, strength: f32) -> vec4f {
    var sum = vec4f(0.0);
    for (var k = 0; k < 16; k++) {
        let f = 1.0 - 0.5 * strength * f32(k) / 15.0;
        sum += zoomed(vec2f(0.5) + (uv - vec2f(0.5)) * f, p, scale_a, scale_b);
    }
    return sum / 16.0;
}
fn transition(uv: vec2f, p: f32) -> vec4f {
    let k = u_scale() / 100.0;
    return zoom_blurred(uv, p, mix(1.0, 1.0 / k, p), mix(k, 1.0, p), u_blur() / 100.0 * sin(PI * p));
}

//# whip-pan | direction:2 blur
fn transition(uv: vec2f, p: f32) -> vec4f {
    let dir = u_direction();
    let reach = dir * (u_blur() * 4.0 * S() * sin(PI * p)) / span(dir);
    var sum = vec4f(0.0);
    for (var k = 0; k < 16; k++) {
        sum += push(uv + reach * (f32(k) / 15.0 - 0.5), dir, p);
    }
    return sum / 16.0;
}

//# spin | turns direction blur
fn spun(uv: vec2f, p: f32, offset: f32) -> vec4f {
    let sign = select(1.0, -1.0, u_direction() > 0.5);
    let full = u_turns() * TAU * sign;
    let v = (uv - vec2f(0.5)) * R();
    let a = A(vec2f(0.5) + rot(v, -(full * p + offset)) / R());
    let b = B(vec2f(0.5) + rot(v, -(full * (p - 1.0) + offset)) / R());
    return mix(a, b, sat((p - 0.4) / 0.2));
}
fn transition(uv: vec2f, p: f32) -> vec4f {
    // Radial blur over an arc of blur × 0.3° × sin(π p).
    let arc = radians(u_blur() * 0.3) * sin(PI * p);
    var sum = vec4f(0.0);
    for (var k = 0; k < 12; k++) {
        sum += spun(uv, p, arc * (f32(k) / 11.0 - 0.5));
    }
    return sum / 12.0;
}

//# roll | direction
fn transition(uv: vec2f, p: f32) -> vec4f {
    let counter = u_direction() > 0.5;
    let pivot = vec2f(select(0.0, R().x, counter), R().y);
    let angle = select(1.0, -1.0, counter) * 0.5 * PI * p;
    let source = pivot + rot(uv * R() - pivot, -angle);
    return over(A(source / R()), B(uv));
}

//# shake-cut | intensity seed
fn transition(uv: vec2f, p: f32) -> vec4f {
    let amplitude = u_intensity() * 0.6 * S() * sin(PI * p);
    let n = vec2f(vnoise1(u_seed(), T() * 24.0), vnoise1(u_seed() + 1.0, T() * 24.0)) * 2.0 - vec2f(1.0);
    let at = uv - n * amplitude / R();
    if (p < 0.5) { return A(at); }
    return B(at);
}

//# pull-focus | blur
// The Gaussian of sigma blur / 5 × s × sin(π p) px runs as passes after this mix.
fn transition(uv: vec2f, p: f32) -> vec4f { return mix(A(uv), B(uv), smoothstep(0.35, 0.65, p)); }

//# blur-dissolve | blur
// The Gaussian of sigma blur / 5 × s × sin(π p) px runs as passes after this mix.
fn transition(uv: vec2f, p: f32) -> vec4f { return mix(A(uv), B(uv), p); }

//# directional-blur-wipe | angle blur
fn transition(uv: vec2f, p: f32) -> vec4f {
    let axis = vec2f(cos(radians(u_angle())), sin(radians(u_angle())));
    let reach = axis * (u_blur() * 4.0 * S() * sin(PI * p)) / R();
    var sum = vec4f(0.0);
    for (var k = 0; k < 16; k++) {
        let at = uv + reach * (f32(k) / 15.0 - 0.5);
        sum += mix(A(at), B(at), p);
    }
    return sum / 16.0;
}

//# zoom-blur-dissolve | blur
fn transition(uv: vec2f, p: f32) -> vec4f {
    let strength = u_blur() / 100.0 * sin(PI * p);
    var sum = vec4f(0.0);
    for (var k = 0; k < 16; k++) {
        let at = vec2f(0.5) + (uv - vec2f(0.5)) * (1.0 - 0.5 * strength * f32(k) / 15.0);
        sum += mix(A(at), B(at), p);
    }
    return sum / 16.0;
}

//# ripple-dissolve | amplitude frequency
fn transition(uv: vec2f, p: f32) -> vec4f {
    let v = (uv - vec2f(0.5)) * R();
    let r = length(v) / half_diagonal();
    let shift = u_amplitude() * 0.3 * S() * sin(PI * p) * sin(TAU * u_frequency() * r - 6.0 * PI * p);
    let at = uv + normalize(v + vec2f(0.00001)) * shift / R();
    return mix(A(at), B(at), p);
}

//# swirl | angle
fn transition(uv: vec2f, p: f32) -> vec4f {
    let v = (uv - vec2f(0.5)) * R();
    let falloff = 1.0 - sat(length(v) / half_diagonal());
    let turn = radians(u_angle()) * sin(PI * p) * falloff * falloff;
    let at = vec2f(0.5) + rot(v, -turn) / R();
    return mix(A(at), B(at), smoothstep(0.3, 0.7, p));
}

//# liquid-warp | strength scale seed
fn field(px: vec2f, cell: f32) -> f32 { return vnoise(u_seed(), px, cell) + 0.5 * vnoise(u_seed() + 1.0, px, cell * 0.5); }
fn transition(uv: vec2f, p: f32) -> vec4f {
    let cell = u_scale() * 8.0 * S();
    let px = uv * R();
    let e = cell * 0.1;
    // The gradient is made dimensionless with the cell size.
    let gradient = vec2f(field(px + vec2f(e, 0.0), cell) - field(px - vec2f(e, 0.0), cell), field(px + vec2f(0.0, e), cell) - field(px - vec2f(0.0, e), cell)) * (cell / (2.0 * e));
    let at = uv + gradient * (u_strength() * 0.5 * S() * sin(PI * p)) / R();
    return mix(A(at), B(at), p);
}

//# domain-warp | strength scale seed
fn domain_field(px: vec2f, cell: f32, offset: f32) -> f32 {
    return vnoise(u_seed() + offset, px, cell) + 0.5 * vnoise(u_seed() + offset + 1.0, px, cell * 0.5);
}
fn transition(uv: vec2f, p: f32) -> vec4f {
    let cell = u_scale() * 7.0 * S();
    let px = uv * R();
    let x = domain_field(px + vec2f(19.1, 3.7) * S(), cell, 0.0) - 0.75;
    let y = domain_field(px + vec2f(7.3, 23.9) * S(), cell, 2.0) - 0.75;
    let warp = vec2f(x, y) * u_strength() * 0.9 * S() * sin(PI * p) / R();
    return mix(A(uv + warp), B(uv - warp), p);
}

//# light-leak-transition | color:3 intensity position
fn transition(uv: vec2f, p: f32) -> vec4f {
    let centre = 0.5 + u_position() / 200.0;
    let drift = (p - 0.5) * 0.32;
    let band = exp(-pow((uv.x - centre - drift) / 0.16, 2.0));
    let vertical = 0.75 + 0.25 * cos(PI * (uv.y - 0.5));
    let base = mix(A(uv), B(uv), p);
    let glow = u_color() * (u_intensity() / 100.0) * band * vertical * sin(PI * p);
    let cover = max(A(uv).a, B(uv).a);
    return vec4f(base.rgb + glow * cover, cover);
}

//# chromatic-split | amount direction
fn transition(uv: vec2f, p: f32) -> vec4f {
    let dir = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), u_direction() > 0.5);
    let offset = dir * (u_amount() * 0.7 * S() * sin(PI * p)) / R();
    let a = A(uv);
    let b = B(uv);
    let centre = mix(a, b, p);
    let red = mix(A(uv + offset).r, B(uv + offset).r, p);
    let blue = mix(A(uv - offset).b, B(uv - offset).b, p);
    return vec4f(red, centre.g, blue, centre.a);
}

//# stretch | direction:2 amount
fn transition(uv: vec2f, p: f32) -> vec4f {
    let dir = u_direction();
    let x = along(uv, dir);
    let gain = u_amount() / 100.0 * 4.0;
    // A is anchored at the far edge (along = 1), B at the edge it enters from (along = 0).
    let from_a = 1.0 - (1.0 - x) / (1.0 + gain * p);
    let from_b = x / (1.0 + gain * (1.0 - p));
    let fade_a = 1.0 - sat((p - 0.5) / 0.5);
    let fade_b = sat(p / 0.5);
    return mix(A(uv + dir * (from_a - x)), B(uv + dir * (from_b - x)), fade_b / max(fade_a + fade_b, 0.0001));
}

//# glitch-cut | intensity seed
fn half_of(uv: vec2f, p: f32) -> vec4f {
    if (p < 0.5) { return A(uv); }
    return B(uv);
}
fn transition(uv: vec2f, p: f32) -> vec4f {
    var at = uv;
    var split = 0.0;
    if (p >= 0.2 && p <= 0.8) {
        let band = cell_index(uv.y * R().y / (16.0 * S()));
        let step_index = u32(floor(p * 12.0));
        if (rand2(u_seed(), band, step_index) < 0.5) {
            let sign = select(-1.0, 1.0, rand2(u_seed() + 1.0, band, step_index) < 0.5);
            at.x += sign * u_intensity() * 0.8 * S() / R().x;
            split = 3.0 * S() / R().x;
        }
    }
    let centre = half_of(at, p);
    return vec4f(half_of(at + vec2f(split, 0.0), p).r, centre.g, half_of(at - vec2f(split, 0.0), p).b, centre.a);
}

//# rgb-split-cut | amount
fn blend_at(uv: vec2f, p: f32) -> vec4f { return mix(A(uv), B(uv), p); }
fn transition(uv: vec2f, p: f32) -> vec4f {
    let d = vec2f(u_amount() * 0.6 * S() * sin(PI * p) / R().x, 0.0);
    let centre = blend_at(uv, p);
    return vec4f(blend_at(uv + d, p).r, centre.g, blend_at(uv - d, p).b, centre.a);
}

//# pixelate | maxBlock
fn transition(uv: vec2f, p: f32) -> vec4f {
    let cell = max(1.0, u_maxBlock() * S() * sin(PI * p));
    let at = (floor(uv * R() / cell) + vec2f(0.5)) * cell / R();
    if (p < 0.5) { return A(at); }
    return B(at);
}

//# signal-noise | intensity seed
fn transition(uv: vec2f, p: f32) -> vec4f {
    var base = A(uv);
    if (p >= 0.5) { base = B(uv); }
    let px = uv * R();
    let n = unit(hash3(hash2(u32(max(u_seed(), 0.0)), FRAME()), cell_index(px.x), cell_index(px.y)));
    return mix(base, tint(vec3f(n), uv), u_intensity() / 100.0 * sin(PI * p));
}

//# flash | color:3 intensity
fn transition(uv: vec2f, p: f32) -> vec4f {
    var base = A(uv);
    if (p >= 0.5) { base = B(uv); }
    let peak = 1.0 - abs(2.0 * p - 1.0);
    return min(base + tint(u_color(), uv) * (u_intensity() / 100.0 * peak * peak), vec4f(1.0));
}

//# light-sweep | color:3 angle width
fn transition(uv: vec2f, p: f32) -> vec4f {
    let x = along_angle(uv, u_angle());
    let front = 1.1 * p - 0.05;
    let weight = 1.0 - smoothstep(front - 0.05, front + 0.05, x);
    let offset = (x - front) / (u_width() / 200.0);
    let band = tint(u_color(), uv) * (exp(-offset * offset) * sin(PI * p));
    return min(mix(A(uv), B(uv), weight) + vec4f(band.rgb, 0.0), vec4f(1.0));
}

//# film-burn | color:3 intensity seed
fn transition(uv: vec2f, p: f32) -> vec4f {
    let px = uv * R();
    let w = R().x;
    let x = 0.5 * vnoise(u_seed(), px, 0.25 * w) + 0.3 * vnoise(u_seed() + 1.0, px, 0.125 * w) + 0.2 * vnoise(u_seed() + 2.0, px, 0.0625 * w);
    let front = p * 1.04 - 0.02;
    let glow = tint(u_color(), uv) * (u_intensity() / 100.0 * (1.0 - smoothstep(0.0, 0.08, abs(x - front))));
    return min(mix(A(uv), B(uv), wipe(x, p, 0.02)) + vec4f(glow.rgb, 0.0), vec4f(1.0));
}

//# glow-dissolve | intensity
// The bright-pass, its Gaussian (sigma 12 × s px) and the addition run as passes after this mix.
fn transition(uv: vec2f, p: f32) -> vec4f { return mix(A(uv), B(uv), p); }

//# split-horizontal | softness
fn transition(uv: vec2f, p: f32) -> vec4f {
    let f = u_softness() / 200.0;
    // The source row of A that the upper (or lower) half shows at this pixel.
    let upper = uv.y + p / 2.0;
    let lower = uv.y - p / 2.0;
    var a = vec4f(0.0);
    if (upper < 0.5) {
        a = A(vec2f(uv.x, upper)) * select(1.0, sat((0.5 - upper) / f), f > 0.0);
    } else if (lower > 0.5) {
        a = A(vec2f(uv.x, lower)) * select(1.0, sat((lower - 0.5) / f), f > 0.0);
    }
    return over(a, B(uv));
}

//# split-vertical | softness
fn transition(uv: vec2f, p: f32) -> vec4f {
    let f = u_softness() / 200.0;
    let left = uv.x + p / 2.0;
    let right = uv.x - p / 2.0;
    var a = vec4f(0.0);
    if (left < 0.5) {
        a = A(vec2f(left, uv.y)) * select(1.0, sat((0.5 - left) / f), f > 0.0);
    } else if (right > 0.5) {
        a = A(vec2f(right, uv.y)) * select(1.0, sat((right - 0.5) / f), f > 0.0);
    }
    return over(a, B(uv));
}

//# diagonal-split | angle
fn transition(uv: vec2f, p: f32) -> vec4f {
    let line = vec2f(cos(radians(u_angle())), sin(radians(u_angle())));
    let normal = vec2f(-line.y, line.x);
    let v = (uv - vec2f(0.5)) * R();
    let d = dot(v, normal);
    let travel = p * half_diagonal();
    // B lies beneath both halves: it shows between them and wherever a half has left the canvas uncovered.
    if (d - travel > 0.0) { return over(A(uv - normal * travel / R()), B(uv)); }
    if (d + travel < 0.0) { return over(A(uv + normal * travel / R()), B(uv)); }
    return B(uv);
}

//# shutter-slices | count orientation
fn transition(uv: vec2f, p: f32) -> vec4f {
    let count = max(u_count(), 1.0);
    // `vertical` (index 1) cuts vertical slices, laid side by side along x.
    let x = select(uv.y, uv.x, u_orientation() > 0.5) * count;
    let k = min(floor(x), count - 1.0);
    let progress = sat(p * 2.0 - k / count);
    if (x - k < progress) { return B(uv); }
    return A(uv);
}

//# iris-circle | softness centerX centerY
fn transition(uv: vec2f, p: f32) -> vec4f {
    let centre = vec2f(0.5) + vec2f(u_centerX(), u_centerY()) / 200.0;
    let corner = max(centre, vec2f(1.0) - centre) * R();
    let x = length((uv - centre) * R()) / max(length(corner), 0.000001);
    return mix(A(uv), B(uv), wipe(x, p, u_softness() / 200.0));
}

//# iris-shape | shape softness
// Radius of the star outline (5 points, inner ratio 0.45, first outer vertex up) at a screen angle, outer radius 1.
fn star_radius(v: vec2f) -> f32 {
    let sector = TAU / 5.0;
    let turn = atan2(v.x, -v.y);
    let folded = abs(fract(turn / sector + 0.5) - 0.5) * sector;
    let outer = vec2f(1.0, 0.0);
    let inner = 0.45 * vec2f(cos(sector / 2.0), sin(sector / 2.0));
    let normal = vec2f(inner.y - outer.y, outer.x - inner.x);
    return dot(normal, outer) / dot(normal, vec2f(cos(folded), sin(folded)));
}
// Cubic bezier point.
fn bezier(a: vec2f, b: vec2f, c: vec2f, d: vec2f, t: f32) -> vec2f {
    let s = 1.0 - t;
    return a * (s * s * s) + b * (3.0 * s * s * t) + c * (3.0 * s * t * t) + d * (t * t * t);
}
// The right half of the heart outline of `masks-blending-keying.Box-like masks`, top notch to bottom tip, at t in 0…2.
fn heart_point(t: f32) -> vec2f {
    if (t < 1.0) { return bezier(vec2f(0.0, -0.25), vec2f(0.05, -0.60), vec2f(0.50, -0.60), vec2f(0.50, -0.15), t); }
    return bezier(vec2f(0.50, -0.15), vec2f(0.50, 0.10), vec2f(0.20, 0.30), vec2f(0.0, 0.5), t - 1.0);
}
// Radius of the heart outline along the direction of `v`, measured from the box centre. The outline is star-shaped
// about the centre and its polar angle grows monotonically along the half, so the crossing is found by bisection.
fn heart_radius(v: vec2f) -> f32 {
    let turn = atan2(abs(v.x), -v.y);
    var low = 0.0;
    var high = 2.0;
    for (var k = 0; k < 14; k++) {
        let middle = (low + high) * 0.5;
        let q = heart_point(middle);
        if (atan2(q.x, -q.y) < turn) { low = middle; } else { high = middle; }
    }
    return length(heart_point((low + high) * 0.5));
}
fn transition(uv: vec2f, p: f32) -> vec4f {
    let v = (uv - vec2f(0.5)) * R();
    let half_size = R() * 0.5;
    var x = 0.0;
    if (u_shape() < 0.5) {
        x = max(abs(v.x) / half_size.x, abs(v.y) / half_size.y);
    } else if (u_shape() < 1.5) {
        x = (abs(v.x) / half_size.x + abs(v.y) / half_size.y) * 0.5;
    } else if (u_shape() < 2.5) {
        // The inner vertices (radius 0.45) reach the corner distance at p = 1.
        x = length(v) / half_diagonal() * 0.45 / star_radius(v);
    } else {
        // The notch (radius 0.25) is the point of the outline nearest to the centre.
        x = length(v) / half_diagonal() * 0.25 / heart_radius(v);
    }
    return mix(A(uv), B(uv), wipe(x, p, u_softness() / 200.0));
}

//# luma-fade | softness invert
fn transition(uv: vec2f, p: f32) -> vec4f {
    let a = A(uv);
    let brightness = luma(a.rgb / max(a.a, 0.0001));
    let x = select(1.0 - brightness, brightness, u_invert() > 0.5);
    return mix(a, B(uv), wipe(x, p, u_softness() / 200.0));
}

//# noise-dissolve | scale softness seed
fn transition(uv: vec2f, p: f32) -> vec4f {
    let x = vnoise(u_seed(), uv * R(), u_scale() * 2.0 * S());
    return mix(A(uv), B(uv), wipe(x, p, u_softness() / 200.0));
}

//# checkerboard | rows columns
fn transition(uv: vec2f, p: f32) -> vec4f {
    let grid = uv * vec2f(u_columns(), u_rows());
    let cell = min(floor(grid), vec2f(u_columns(), u_rows()) - vec2f(1.0));
    let even = fract((cell.x + cell.y) * 0.5) < 0.25;
    let progress = select(sat(p * 2.0 - 1.0), sat(p * 2.0), even);
    if (grid.x - cell.x < progress) { return B(uv); }
    return A(uv);
}

//# ink-spread | color:3 softness seed
fn transition(uv: vec2f, p: f32) -> vec4f {
    let px = uv * R();
    var nearest = 1000000.0;
    for (var i = 0u; i < 5u; i++) {
        let point = vec2f(rand(u_seed(), 2u * i), rand(u_seed(), 2u * i + 1u)) * R();
        nearest = min(nearest, length(px - point));
    }
    let cell = 0.08 * R().x;
    let n = (vnoise(u_seed(), px, cell) + 0.5 * vnoise(u_seed() + 1.0, px, cell * 0.5)) / 1.5;
    let f = nearest / (2.0 * half_diagonal()) + 0.15 * (n - 0.5);
    let w = u_softness() / 200.0;
    let ink = tint(u_color(), uv);
    if (p < 0.5) {
        let edge = 2.4 * p;
        let amount = select(step(f, edge), 1.0 - smoothstep(edge - w, edge + w, f), w > 0.0);
        return mix(A(uv), ink, amount);
    }
    let edge = 2.4 * p - 1.3;
    let amount = select(step(edge, f), smoothstep(edge - w, edge + w, f), w > 0.0);
    return mix(B(uv), ink, amount);
}

//# paper-tear | direction:2 edgeColor:3
fn transition(uv: vec2f, p: f32) -> vec4f {
    let dir = u_direction();
    let x = along(uv, dir);
    // The coordinate across `dir`, 0…1.
    let across = dot(uv, abs(vec2f(dir.y, dir.x)));
    let front = 1.06 * (1.0 - p) - 0.03 + 0.03 * (2.0 * vnoise1(0.0, across * 12.0) - 1.0);
    if (x > front) { return B(uv); }
    if (x > front - 6.0 * S() / span(dir)) { return tint(u_edgeColor(), uv); }
    return A(uv);
}

//# color-bars | colorA:3 colorB:3 colorC:3 direction:2
fn transition(uv: vec2f, p: f32) -> vec4f {
    let x = along(uv, u_direction());
    if (x < sat((p - 0.5) / 0.5)) { return B(uv); }
    if (x < sat((p - 0.24) / 0.5)) { return tint(u_colorC(), uv); }
    if (x < sat((p - 0.12) / 0.5)) { return tint(u_colorB(), uv); }
    if (x < sat(p / 0.5)) { return tint(u_colorA(), uv); }
    return A(uv);
}

//# circle-burst | color:3 rings
fn transition(uv: vec2f, p: f32) -> vec4f {
    let d = half_diagonal();
    let r = length((uv - vec2f(0.5)) * R());
    let rings = max(u_rings(), 1.0);
    var painted = false;
    var innermost = 0.0;
    for (var k = 0.0; k < rings; k += 1.0) {
        let outer = sat((p - k * 0.5 / rings) / 0.5) * 1.12 * d;
        let inner = max(0.0, outer - 0.12 * d);
        if (r >= inner && r < outer) { painted = true; }
        innermost = inner;
    }
    if (r < innermost) { return B(uv); }
    if (painted) { return tint(u_color(), uv); }
    return A(uv);
}

//# swipe-up | bounce
fn transition(uv: vec2f, p: f32) -> vec4f {
    let q = p + u_bounce() / 100.0 * 0.1 * sin(TAU * p) * (1.0 - p);
    return push(uv, vec2f(0.0, -1.0), q);
}

//# flip | axis
fn transition(uv: vec2f, p: f32) -> vec4f {
    // `horizontal` (index 0) turns the card about the vertical centre axis.
    let about_y = u_axis() < 0.5;
    let v = (uv - vec2f(0.5)) * R();
    let across = select(v.y, v.x, about_y);
    let extent = select(R().y, R().x, about_y);
    let distance = 2.5 * extent;
    let turn = PI * p;
    // The ray from the camera through this pixel meets the card plane where n · (o + λ d) = 0.
    let denominator = across * sin(turn) + distance * cos(turn);
    if (abs(denominator) < 0.0001) { return vec4f(0.0); }
    let lambda = distance * cos(turn) / denominator;
    if (lambda <= 0.0) { return vec4f(0.0); }
    let hit = vec3f(v * lambda, distance * (lambda - 1.0));
    let hit_across = select(hit.y, hit.x, about_y);
    // The card's own coordinate across the axis.
    var s = hit_across * cos(turn) - hit.z * sin(turn);
    let back = p >= 0.5;
    if (back) { s = -s; }
    var card = vec2f(s, hit.y);
    if (!about_y) { card = vec2f(hit.x, s); }
    let at = card / R() + vec2f(0.5);
    if (back) { return B(at); }
    return A(at);
}

//# page-turn | direction:2 shadow
fn transition(uv: vec2f, p: f32) -> vec4f {
    let dir = u_direction();
    // `x` runs in canvas extents along the axis, from the edge the page turns toward (0) to where the curl starts (1).
    let x = 1.0 - along(uv, dir);
    let x0 = 1.16 - 1.48 * p;
    let r = 0.08;
    let d = x - x0;
    // A point of A that sits `shift` further along the page than this pixel.
    if (d <= 0.0) {
        // The part of the page that has gone round lies flat on top, back side up.
        let flat = x0 + PI * r - d;
        if (flat <= 1.0) {
            let back = A(uv - dir * (flat - x));
            if (back.a > 0.0) { return vec4f(back.rgb * 0.7, back.a); }
        }
        return A(uv);
    }
    var below = B(uv);
    let shade = u_shadow() / 100.0 * 0.5 * exp(-max(0.0, d - r) / 0.05);
    below = vec4f(below.rgb * (1.0 - shade), below.a);
    if (d <= r) {
        let theta = asin(d / r);
        let back_at = x0 + r * (PI - theta);
        let front_at = x0 + r * theta;
        var page = vec4f(0.0);
        if (front_at <= 1.0) { page = A(uv - dir * (front_at - x)); }
        if (back_at <= 1.0) {
            let back = A(uv - dir * (back_at - x));
            page = over(vec4f(back.rgb * 0.7, back.a), page);
        }
        return over(page, below);
    }
    return below;
}

//# cube-rotate | direction:2 perspective
fn transition(uv: vec2f, p: f32) -> vec4f {
    // `axis` points to the side B comes from; `cross_axis` is the other canvas axis.
    let axis = -u_direction();
    let cross_axis = abs(vec2f(axis.y, axis.x));
    let v = (uv - vec2f(0.5)) * R();
    let a = dot(v, axis);
    let c = dot(v, cross_axis);
    let size_a = span(axis);
    let size_c = dot(R(), cross_axis);
    let fov = radians(20.0 + u_perspective() * 0.4);
    let distance = (R().y * 0.5) / tan(fov * 0.5);
    let turn = 0.5 * PI * p;
    // Ray in box coordinates (a, c, z): the box turns so that its +a face comes to the front.
    let origin_z = -size_a * 0.5 - distance;
    let o = vec2f(-origin_z * sin(turn), origin_z * cos(turn));
    let d = vec2f(a * cos(turn) - distance * sin(turn), a * sin(turn) + distance * cos(turn));
    var best = 1000000000.0;
    var out = vec4f(0.0);
    // Face A: z = −size_a / 2.
    if (abs(d.y) > 0.0001) {
        let lambda = (-size_a * 0.5 - o.y) / d.y;
        let hit_a = o.x + lambda * d.x;
        let hit_c = c * lambda;
        if (lambda > 0.0 && abs(hit_a) <= size_a * 0.5 && abs(hit_c) <= size_c * 0.5) {
            best = lambda;
            out = A((axis * hit_a + cross_axis * hit_c) / R() + vec2f(0.5));
        }
    }
    // Face B: a = +size_a / 2; along it, z plays the part of a.
    if (abs(d.x) > 0.0001) {
        let lambda = (size_a * 0.5 - o.x) / d.x;
        let hit_z = o.y + lambda * d.y;
        let hit_c = c * lambda;
        if (lambda > 0.0 && lambda < best && abs(hit_z) <= size_a * 0.5 && abs(hit_c) <= size_c * 0.5) {
            out = B((axis * hit_z + cross_axis * hit_c) / R() + vec2f(0.5));
        }
    }
    return out;
}
