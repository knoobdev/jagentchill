use std::collections::HashMap;

use gpu::{GpuContext, wgpu};

type TextureKey = (u32, u32);

#[derive(Default)]
pub struct TexturePool {
    available: HashMap<TextureKey, Vec<wgpu::Texture>>,
    in_use: Vec<(TextureKey, wgpu::Texture)>,
    created: u64,
}

impl TexturePool {
    pub fn recycle_frame(&mut self) {
        for (key, texture) in self.in_use.drain(..) {
            self.available.entry(key).or_default().push(texture);
        }
    }

    /// GPU textures created by the pool since it was made; steady-state rendering adds none.
    pub fn created(&self) -> u64 {
        self.created
    }

    /// Destroys every pooled target: on resize, on `memory.trim` and on device loss.
    pub fn clear(&mut self) {
        self.available.clear();
        self.in_use.clear();
    }

    /// Bytes held by pooled targets (width × height × 4 each).
    pub fn bytes(&self) -> u64 {
        let pooled: u64 = self.available.iter().map(|((width, height), list)| u64::from(*width) * u64::from(*height) * 4 * list.len() as u64).sum();
        let used: u64 = self.in_use.iter().map(|((width, height), _)| u64::from(*width) * u64::from(*height) * 4).sum();
        pooled + used
    }

    pub fn acquire(
        &mut self,
        context: &GpuContext,
        width: u32,
        height: u32,
        label: &'static str,
    ) -> wgpu::Texture {
        let key = (width, height);
        let texture = self
            .available
            .get_mut(&key)
            .and_then(Vec::pop)
            .unwrap_or_else(|| {
                self.created += 1;
                context.create_render_texture(width, height, label)
            });
        self.in_use.push((key, texture.clone()));
        texture
    }
}
