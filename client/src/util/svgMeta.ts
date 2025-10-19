export function extractSkuSerialFromSvg(
  svgText: string
): { sku: string; serial: string } | null {
  const match = svgText.match(/<!--META:(.*?)-->/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[1]);
    if (obj.sku && obj.serial) return { sku: obj.sku, serial: obj.serial };
    return null;
  } catch {
    return null;
  }
}
