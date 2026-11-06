/**
 * The engine's one alpha convention is straight alpha, from a texture's source to the composite. An `ImageBitmap`
 * is premultiplied unless it is asked not to be, and WebGL uploads a bitmap as it is stored: a texture made this way
 * would be multiplied by its alpha a second time in the compositor. Every bitmap that becomes a texture is made here.
 */
export function straightBitmap(source: ImageBitmapSource, options: ImageBitmapOptions = {}): Promise<ImageBitmap> {
  return createImageBitmap(source, { ...options, premultiplyAlpha: "none" });
}
