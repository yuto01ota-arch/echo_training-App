// Equal progress increments produce equal distances along a straight line.
export function pointOnSegment({ start, end }, progress) {
  const t = Math.max(0, Math.min(1, progress));
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

// All arguments use screen pixels. Only movement along the line advances it;
// horizontal, vertical and diagonal paths share the same drag behavior.
export function dragProgress({ start, end }, delta) {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const lengthSquared = x * x + y * y;
  return lengthSquared > 0 ? (delta.x * x + delta.y * y) / lengthSquared : 0;
}
