/** The pixel size of a picked image file, as the browser decodes it; `null` when it is not an image the browser can draw. An SVG without a size of its own is 512 × 512. */
export function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file), image = new Image();
    const done = (size: { width: number; height: number } | null) => { URL.revokeObjectURL(url); resolve(size); };
    image.onload = () => done({ width: image.naturalWidth || 512, height: image.naturalHeight || 512 });
    image.onerror = () => done(null);
    image.src = url;
  });
}
