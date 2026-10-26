/** Reduce una foto a JPEG con el lado largo como mucho de `max` px. Así una foto de 12 MP
 * del móvil sube en unos cientos de KB, y de paso el HEIC del iPhone llega como JPEG (Safari
 * sabe pintarlo en un canvas aunque la API no lo acepte). */
export async function shrinkPhoto(file: File, max = 2000): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  const source: CanvasImageSource & { width: number; height: number } = bitmap ?? (await loadImage(file));
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  bitmap?.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se ha podido preparar la foto"))), "image/jpeg", 0.85),
  );
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Esa imagen no se puede abrir"));
    img.src = URL.createObjectURL(file);
  });
}
