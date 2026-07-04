/**
 * DemoForge renderer — screenshot annotation module.
 *
 * Draws boxes, arrows, and blur regions on screenshot images using Sharp.
 */

import sharp from 'sharp';

import type {
  Annotation,
  ArrowAnnotation,
  BoxAnnotation,
  BlurAnnotation,
  Point,
  Rect,
} from './types.js';

// ─── Apply Annotations ───────────────────────────────────────────────────────

/**
 * Apply annotations to a screenshot image buffer.
 * Returns a new buffer with all annotations composited.
 */
export async function applyAnnotations(
  imageBuffer: Buffer,
  annotations: Annotation[],
): Promise<Buffer> {
  if (annotations.length === 0) {
    return imageBuffer;
  }

  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width === 0 || height === 0) {
    return imageBuffer;
  }

  // Separate annotations by type for efficient processing
  const boxes = annotations.filter((a): a is BoxAnnotation => a.type === 'box');
  const arrows = annotations.filter((a): a is ArrowAnnotation => a.type === 'arrow');
  const blurs = annotations.filter((a): a is BlurAnnotation => a.type === 'blur');

  // Build composite input
  const compositeInputs: Array<{ input: Buffer; top: number; left: number }> = [];

  // Process boxes: draw as overlay images positioned at the box rect
  for (const box of boxes) {
    const overlay = await drawBox(box, width, height);
    compositeInputs.push({
      input: overlay,
      top: Math.max(0, Math.round(box.rect.y)),
      left: Math.max(0, Math.round(box.rect.x)),
    });
  }

  // Process arrows: draw as overlay images
  for (const arrow of arrows) {
    const overlay = await drawArrow(arrow, width, height);
    compositeInputs.push({ input: overlay, top: 0, left: 0 });
  }

  // Process blurs: apply blur to specific regions
  for (const blur of blurs) {
    const blurredOverlay = await createBlurOverlay(blur, width, height, imageBuffer);
    if (blurredOverlay.length > 0) {
      compositeInputs.push({ input: blurredOverlay, top: 0, left: 0 });
    }
  }

  // Composite all overlays onto the original image
  if (compositeInputs.length === 0) {
    return imageBuffer;
  }

  const result = await image.composite(compositeInputs).toBuffer();
  return result;
}

// ─── Draw Box ────────────────────────────────────────────────────────────────

/**
 * Draw a colored rectangle border on a transparent PNG overlay.
 */
async function drawBox(
  annotation: BoxAnnotation,
  _imageWidth: number,
  _imageHeight: number,
): Promise<Buffer> {
  const { rect, color = '#ff0000', borderWidth = 2, label } = annotation;

  // Create transparent overlay
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
      <rect x="0" y="0" width="${rect.width}" height="${rect.height}"
            fill="none" stroke="${color}" stroke-width="${borderWidth}" rx="2"/>
    </svg>`,
    'utf-8',
  );

  let result = await sharp(overlay).png().toBuffer();

  // Add label if provided
  if (label) {
    const labelOverlay = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
        <rect x="0" y="0" fill="rgba(0,0,0,0.7)" width="${rect.width}" height="24" rx="2"/>
        <text x="4" y="17" fill="white" font-size="12" font-family="sans-serif">${escapeXml(label)}</text>
      </svg>`,
      'utf-8',
    );

    const labelBuffer = await sharp(labelOverlay).png().resize({
      width: rect.width,
      height: 24,
    }).toBuffer();

    result = await sharp(result)
      .composite([{ input: labelBuffer, top: 0, left: 0 }])
      .toBuffer();
  }

  return result;
}

// ─── Draw Arrow ──────────────────────────────────────────────────────────────

/**
 * Draw an arrow with optional label on a transparent PNG overlay.
 */
async function drawArrow(
  annotation: ArrowAnnotation,
  imageWidth: number,
  imageHeight: number,
): Promise<Buffer> {
  const {
    from,
    to,
    color = '#ff0000',
    lineWidth = 2,
    arrowSize = 10,
    label,
  } = annotation;

  // Clamp coordinates to image bounds
  const clampedFrom = clampPoint(from, imageWidth, imageHeight);
  const clampedTo = clampPoint(to, imageWidth, imageHeight);

  const svgWidth = imageWidth;
  const svgHeight = imageHeight;

  const labelText = label ? escapeXml(label) : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
    <defs>
      <marker id="arrowhead" markerWidth="${arrowSize}" markerHeight="${arrowSize}"
              refX="${arrowSize - 2}" refY="${arrowSize / 2}" orient="auto">
        <polygon points="0 0, ${arrowSize} ${arrowSize / 2}, 0 ${arrowSize}"
                 fill="${color}"/>
      </marker>
    </defs>
    <line x1="${clampedFrom.x}" y1="${clampedFrom.y}" x2="${clampedTo.x}" y2="${clampedTo.y}"
          stroke="${color}" stroke-width="${lineWidth}" marker-end="url(#arrowhead)"/>
    ${label ? `<text x="${(clampedFrom.x + clampedTo.x) / 2}" y="${(clampedFrom.y + clampedTo.y) / 2 - 8}"
          fill="${color}" font-size="12" font-family="sans-serif" text-anchor="middle">${labelText}</text>` : ''}
  </svg>`;

  const result = await sharp(Buffer.from(svg, 'utf-8')).png().toBuffer();
  return result;
}

// Arrowhead is rendered via SVG marker-end attribute in drawArrow

// ─── Blur Overlay ────────────────────────────────────────────────────────────

/**
 * Create a blur overlay for a specific region.
 * Strategy: extract the region, blur it, and composite it back.
 */
async function createBlurOverlay(
  annotation: BlurAnnotation,
  imageWidth: number,
  imageHeight: number,
  originalBuffer: Buffer,
): Promise<Buffer> {
  const { rect, sigma = 10 } = annotation;

  // Clamp rect to image bounds
  const clamped = clampRect(rect, imageWidth, imageHeight);

  if (clamped.width <= 0 || clamped.height <= 0) {
    return Buffer.from('');
  }

  // Extract the region from the original image
  const region = await sharp(originalBuffer)
    .extract({
      left: Math.max(0, clamped.x),
      top: Math.max(0, clamped.y),
      width: clamped.width,
      height: clamped.height,
    })
    .toBuffer();

  // Apply Gaussian blur to the extracted region
  const blurredRegion = await sharp(region)
    .blur(sigma)
    .png()
    .toBuffer();

  // Create a transparent overlay with the blurred region at the correct position
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}">
      <image href="data:image/png;base64,${blurredRegion.toString('base64')}"
             x="${Math.max(0, clamped.x)}" y="${Math.max(0, clamped.y)}"
             width="${clamped.width}" height="${clamped.height}"/>
    </svg>`,
    'utf-8',
  );

  const result = await sharp(overlay).png().toBuffer();
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: Math.max(0, Math.min(point.x, width)),
    y: Math.max(0, Math.min(point.y, height)),
  };
}

function clampRect(rect: Rect, width: number, height: number): Rect {
  return {
    x: Math.max(0, Math.min(rect.x, width)),
    y: Math.max(0, Math.min(rect.y, height)),
    width: Math.min(rect.width, width - Math.max(0, rect.x)),
    height: Math.min(rect.height, height - Math.max(0, rect.y)),
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
