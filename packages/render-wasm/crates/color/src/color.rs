//! Colour maths of the engine, written once on the CPU. The shaders implement the same formulas; these functions
//! are what their output is checked against and what the TypeScript side mirrors for baked recipes.

pub mod blend;
pub mod lut;
pub mod transfer;
pub mod wheels;

pub use blend::{BLEND_MODE_IDS, blend_channel_modes, blend_rgb, composite};
pub use lut::{Lut3d, LutError, parse_cube};
pub use transfer::{luma_709, srgb_eotf, srgb_oetf};
pub use wheels::{WheelChannels, WheelPuck, wheel_channels, wheel_transfer};
