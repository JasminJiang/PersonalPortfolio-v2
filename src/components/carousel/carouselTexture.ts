export interface TextureCrop {
  offsetX: number;
  offsetY: number;
  repeatX: number;
  repeatY: number;
}

export function coverTextureCrop(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): TextureCrop {
  if (imageWidth <= 0 || imageHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { offsetX: 0, offsetY: 0, repeatX: 1, repeatY: 1 };
  }

  const imageAspect = imageWidth / imageHeight;
  const frameAspect = frameWidth / frameHeight;

  if (imageAspect > frameAspect) {
    const repeatX = frameAspect / imageAspect;
    return { offsetX: (1 - repeatX) / 2, offsetY: 0, repeatX, repeatY: 1 };
  }

  const repeatY = imageAspect / frameAspect;
  return { offsetX: 0, offsetY: (1 - repeatY) / 2, repeatX: 1, repeatY };
}
