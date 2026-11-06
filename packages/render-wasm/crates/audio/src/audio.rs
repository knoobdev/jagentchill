//! Audio processing of the engine at its 48 000 Hz internal rate.

pub mod wsola;

pub use wsola::{Wsola, HOP, OVERLAP, SEEK, SEQUENCE};
