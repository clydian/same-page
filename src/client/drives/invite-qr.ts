// Loaded on demand: other application routes do not need a QR decoder.
export async function decodeInviteQr(source: CanvasImageSource, width: number, height: number) {
  if (!width || !height) return null;
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas_unavailable");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const { default: jsQR } = await import("jsqr");
  return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
}

export async function decodeInviteImage(file: File) {
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) throw new Error("invalid_image");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await decodeInviteQr(image, image.naturalWidth, image.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}
