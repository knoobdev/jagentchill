use std::collections::HashMap;

use gpu::wgpu;

pub struct StoredTexture {
    texture: wgpu::Texture,
}

impl StoredTexture {
    pub fn new(texture: wgpu::Texture) -> Self {
        Self { texture }
    }

    pub fn texture(&self) -> &wgpu::Texture {
        &self.texture
    }
}

#[derive(Default)]
pub struct TextureStore {
    textures: HashMap<String, StoredTexture>,
}

impl TextureStore {
    pub fn upsert(&mut self, id: String, texture: wgpu::Texture) {
        self.textures.insert(id, StoredTexture::new(texture));
    }

    pub fn get(&self, id: &str) -> Option<&StoredTexture> {
        self.textures.get(id)
    }

    pub fn remove(&mut self, id: &str) {
        self.textures.remove(id);
    }

    pub fn clear(&mut self) {
        self.textures.clear();
    }

    pub fn len(&self) -> usize {
        self.textures.len()
    }

    /// Bytes of the stored textures, counted as width × height × 4 each.
    pub fn bytes(&self) -> u64 {
        self.textures.values().map(|stored| u64::from(stored.texture.width()) * u64::from(stored.texture.height()) * 4).sum()
    }
}
