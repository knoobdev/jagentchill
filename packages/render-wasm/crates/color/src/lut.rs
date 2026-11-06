//! 3D lookup tables: the `.cube` text format and tetrahedral interpolation for every size from 2 to 65 per edge.

#[derive(Clone, Debug, PartialEq)]
pub struct Lut3d {
    pub size: usize,
    /// `size³` RGB triples, red varying fastest (the order of a `.cube` file).
    pub data: Vec<[f32; 3]>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LutError {
    MissingSize,
    SizeOutOfRange(usize),
    BadLine(usize),
    WrongCount { expected: usize, found: usize },
}

/// Parses a `.cube` file. `DOMAIN_MIN` / `DOMAIN_MAX` other than 0…1 rescale the output; a 1D table is refused.
pub fn parse_cube(text: &str) -> Result<Lut3d, LutError> {
    let mut size = None;
    let mut data = Vec::new();
    let (mut low, mut high) = ([0.0_f32; 3], [1.0_f32; 3]);
    for (index, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let first = parts.next().unwrap_or("");
        let triple = |parts: &mut std::str::SplitWhitespace| -> Option<[f32; 3]> {
            let mut out = [0.0; 3];
            for value in &mut out {
                *value = parts.next()?.parse().ok()?;
            }
            Some(out)
        };
        match first {
            "TITLE" => {}
            "LUT_3D_SIZE" => {
                let parsed: usize = parts.next().and_then(|value| value.parse().ok()).ok_or(LutError::BadLine(index + 1))?;
                if !(2..=65).contains(&parsed) {
                    return Err(LutError::SizeOutOfRange(parsed));
                }
                size = Some(parsed);
            }
            "LUT_1D_SIZE" => return Err(LutError::MissingSize),
            "DOMAIN_MIN" => low = triple(&mut parts).ok_or(LutError::BadLine(index + 1))?,
            "DOMAIN_MAX" => high = triple(&mut parts).ok_or(LutError::BadLine(index + 1))?,
            _ => {
                let mut values = line.split_whitespace();
                let entry = triple(&mut values).ok_or(LutError::BadLine(index + 1))?;
                if entry.iter().any(|value| !value.is_finite()) {
                    return Err(LutError::BadLine(index + 1));
                }
                data.push(entry);
            }
        }
    }
    let size = size.ok_or(LutError::MissingSize)?;
    if data.len() != size * size * size {
        return Err(LutError::WrongCount { expected: size * size * size, found: data.len() });
    }
    if low != [0.0; 3] || high != [1.0; 3] {
        for entry in &mut data {
            for channel in 0..3 {
                let width = high[channel] - low[channel];
                entry[channel] = if width > 0.0 { (entry[channel] - low[channel]) / width } else { entry[channel] };
            }
        }
    }
    Ok(Lut3d { size, data })
}

impl Lut3d {
    pub fn identity(size: usize) -> Self {
        let last = (size - 1) as f32;
        let mut data = Vec::with_capacity(size * size * size);
        for blue in 0..size {
            for green in 0..size {
                for red in 0..size {
                    data.push([red as f32 / last, green as f32 / last, blue as f32 / last]);
                }
            }
        }
        Self { size, data }
    }

    fn at(&self, red: usize, green: usize, blue: usize) -> [f32; 3] {
        self.data[red + self.size * (green + self.size * blue)]
    }

    /// Tetrahedral interpolation of an RGB value in 0…1.
    pub fn sample(&self, rgb: [f32; 3]) -> [f32; 3] {
        let last = self.size - 1;
        let mut base = [0usize; 3];
        let mut fraction = [0.0_f32; 3];
        for channel in 0..3 {
            let position = rgb[channel].clamp(0.0, 1.0) * last as f32;
            base[channel] = (position.floor() as usize).min(last - 1);
            fraction[channel] = position - base[channel] as f32;
        }
        let corner = |dr: usize, dg: usize, db: usize| self.at(base[0] + dr, base[1] + dg, base[2] + db);
        let (r, g, b) = (fraction[0], fraction[1], fraction[2]);
        // The cube is split into six tetrahedra along its main diagonal; the path from c000 to c111 follows the
        // channels in decreasing order of their fraction.
        let (first, second, w) = if r >= g {
            if g >= b {
                (corner(1, 0, 0), corner(1, 1, 0), [r, g, b])
            } else if r >= b {
                (corner(1, 0, 0), corner(1, 0, 1), [r, b, g])
            } else {
                (corner(0, 0, 1), corner(1, 0, 1), [b, r, g])
            }
        } else if b >= g {
            (corner(0, 0, 1), corner(0, 1, 1), [b, g, r])
        } else if b >= r {
            (corner(0, 1, 0), corner(0, 1, 1), [g, b, r])
        } else {
            (corner(0, 1, 0), corner(1, 1, 0), [g, r, b])
        };
        let (c000, c111) = (corner(0, 0, 0), corner(1, 1, 1));
        let mut out = [0.0; 3];
        for channel in 0..3 {
            out[channel] = (1.0 - w[0]) * c000[channel] + (w[0] - w[1]) * first[channel] + (w[1] - w[2]) * second[channel] + w[2] * c111[channel];
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::{Lut3d, LutError, parse_cube};

    #[test]
    fn identity_tables_of_every_size_return_their_input() {
        for size in [2, 3, 17, 33, 65] {
            let lut = Lut3d::identity(size);
            for step in 0..=20 {
                let value = step as f32 / 20.0;
                let input = [value, 1.0 - value, (value * 0.37 + 0.2).fract()];
                let out = lut.sample(input);
                for channel in 0..3 {
                    assert!((out[channel] - input[channel]).abs() < 1.0 / 255.0, "size {size}: {out:?} for {input:?}");
                }
            }
        }
    }

    #[test]
    fn parses_a_cube_file() {
        let text = "TITLE \"t\"\n# comment\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";
        assert_eq!(parse_cube(text), Ok(Lut3d::identity(2)));
        assert_eq!(parse_cube("LUT_3D_SIZE 2\n0 0 0\n"), Err(LutError::WrongCount { expected: 8, found: 1 }));
        assert_eq!(parse_cube("LUT_3D_SIZE 66\n"), Err(LutError::SizeOutOfRange(66)));
        assert_eq!(parse_cube("0 0 0\n"), Err(LutError::MissingSize));
    }

    #[test]
    fn interpolates_inside_a_cell() {
        // A table that inverts red: the midpoint of a cell is the mean of its ends.
        let mut lut = Lut3d::identity(2);
        for entry in &mut lut.data {
            entry[0] = 1.0 - entry[0];
        }
        let out = lut.sample([0.25, 0.5, 0.75]);
        assert!((out[0] - 0.75).abs() < 1e-6 && (out[1] - 0.5).abs() < 1e-6 && (out[2] - 0.75).abs() < 1e-6);
    }
}
