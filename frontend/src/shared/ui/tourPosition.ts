interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TourPosition {
  focus: Bounds;
  panel: { x: number; y: number };
  pointer: { x: number; y: number; length: number; angle: number };
}

export function positionTour(target: DOMRect, panel: DOMRect, width: number, height: number): TourPosition {
  const margin = 12;
  const gap = 22;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const left = clamp(target.left - 5, 4, width - 8);
  const top = clamp(target.top - 5, 4, height - 8);
  const right = clamp(target.right + 5, left + 4, width - 4);
  const bottom = clamp(target.bottom + 5, top + 4, height - 4);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;

  let x = clamp(cx - panel.width / 2, margin, width - panel.width - margin);
  let y = clamp(cy - panel.height / 2, margin, height - panel.height - margin);
  let startX: number;
  let startY: number;
  let endX: number;
  let endY: number;

  if (width - right >= panel.width + gap + margin || left >= panel.width + gap + margin) {
    const onRight = width - right >= panel.width + gap + margin;
    x = onRight ? right + gap : left - gap - panel.width;
    startX = onRight ? x : x + panel.width;
    startY = clamp(cy, y + margin, y + panel.height - margin);
    endX = onRight ? right + 4 : left - 4;
    endY = cy;
  } else {
    const below = height - bottom >= panel.height + gap + margin || height - bottom >= top;
    y = clamp(below ? bottom + gap : top - gap - panel.height, margin, height - panel.height - margin);
    startX = clamp(cx, x + margin, x + panel.width - margin);
    startY = below ? y : y + panel.height;
    endX = cx;
    endY = below ? bottom + 4 : top - 4;
  }

  const dx = endX - startX;
  const dy = endY - startY;
  return {
    focus: { x: left, y: top, width: right - left, height: bottom - top },
    panel: { x, y },
    pointer: { x: startX, y: startY, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) },
  };
}
