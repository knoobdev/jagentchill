use color::BLEND_MODE_IDS;

/// A blend mode by its shader code 0–16, the position of its id in the one list `color::BLEND_MODE_IDS`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlendMode(u32);

impl BlendMode {
    pub const NORMAL: Self = Self(0);

    /// The mode with this kebab-case id; `None` for an id outside the list.
    pub fn from_id(id: &str) -> Option<Self> {
        BLEND_MODE_IDS.iter().position(|known| *known == id).map(|code| Self(code as u32))
    }

    pub fn shader_code(self) -> u32 {
        self.0
    }

    pub fn id(self) -> &'static str {
        BLEND_MODE_IDS[self.0 as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::BlendMode;

    #[test]
    fn codes_follow_the_list() {
        assert_eq!(BlendMode::from_id("normal"), Some(BlendMode::NORMAL));
        assert_eq!(BlendMode::from_id("multiply").map(BlendMode::shader_code), Some(2));
        assert_eq!(BlendMode::from_id("luminosity").map(BlendMode::shader_code), Some(16));
        assert_eq!(BlendMode::from_id("linear-light"), None);
    }
}
