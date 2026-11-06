# render-wasm

The compositor of JAgentChill: Rust (wgpu) compiled to WebAssembly, shared by web, desktop and the engine surface on
mobile. The crates under `crates/` and `wasm/` started as a copy of OpenCut classic's `rust/` tree (MIT, see
`LICENSE.opencut`) and are extended here.

    cargo test                                             # crate tests, native
    cargo build -p opencut-wasm --target wasm32-unknown-unknown --release

## Third-party crates of the `text` crate

Licences as declared in each crate's manifest (`cargo metadata`), recorded when the dependency was added.

| Crate | Version | Licence |
|---|---|---|
| rustybuzz | 0.20.1 | MIT |
| ttf-parser | 0.25.1 | MIT OR Apache-2.0 |
| unicode-bidi | 0.3.18 | MIT OR Apache-2.0 |
| unicode-linebreak | 0.1.5 | Apache-2.0 |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 |
| unicode-bidi-mirroring | 0.4.0 | MIT OR Apache-2.0 |
| unicode-ccc | 0.4.0 | MIT OR Apache-2.0 |
| unicode-properties | 0.1.4 | MIT OR Apache-2.0 |
| unicode-script | 0.5.8 | MIT OR Apache-2.0 |
| core_maths | 0.1.1 | MIT |
| libm | 0.2.16 | MIT |
| smallvec | 1.15.1 | MIT OR Apache-2.0 |
| bitflags | 2.11.0 | MIT OR Apache-2.0 |
| bytemuck | 1.25.0 | Zlib OR Apache-2.0 OR MIT |
| log | 0.4.29 | MIT OR Apache-2.0 |
