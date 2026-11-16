"use strict";

// 線の中心だけを比較する。配置の採点・スタンプ・改善コメントとは独立させる。
const ShapeEvaluation = (() => {
  const VERSION = "shape-v1";
  const SOURCE_SIZE = 192;
  const GRID_SIZE = 128;
  const SPAN = 112;
  const TOLERANCE = 1.5;

  function imageMask(image) {
    const mask = new Uint8Array(SOURCE_SIZE * SOURCE_SIZE);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const offset = (y * image.width + x) * 4;
        const luminance = (image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722) / 255;
        if (image.data[offset + 3] / 255 * (1 - luminance) < 0.18) continue;
        // 周囲に1pxの空白を確保し、画像の端の線も細線化の対象にする。
        const px = 1 + Math.floor(x * (SOURCE_SIZE - 2) / image.width);
        const py = 1 + Math.floor(y * (SOURCE_SIZE - 2) / image.height);
        mask[py * SOURCE_SIZE + px] = 1;
      }
    }
    return mask;
  }

  // Zhang–Suenの2段階細線化。削除候補は同時に消し、線の接続を保つ。
  function skeletonize(mask) {
    let changed;
    do {
      changed = false;
      for (let phase = 0; phase < 2; phase++) {
        const remove = [];
        for (let y = 1; y < SOURCE_SIZE - 1; y++) {
          for (let x = 1; x < SOURCE_SIZE - 1; x++) {
            const i = y * SOURCE_SIZE + x;
            if (!mask[i]) continue;
            const n = [mask[i - SOURCE_SIZE], mask[i - SOURCE_SIZE + 1], mask[i + 1], mask[i + SOURCE_SIZE + 1],
              mask[i + SOURCE_SIZE], mask[i + SOURCE_SIZE - 1], mask[i - 1], mask[i - SOURCE_SIZE - 1]];
            const count = n.reduce((sum, value) => sum + value, 0);
            if (count < 2 || count > 6) continue;
            let transitions = 0;
            for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) transitions++;
            if (transitions !== 1) continue;
            const connected = phase === 0
              ? n[0] * n[2] * n[4] === 0 && n[2] * n[4] * n[6] === 0
              : n[0] * n[2] * n[6] === 0 && n[0] * n[4] * n[6] === 0;
            if (connected) remove.push(i);
          }
        }
        for (const i of remove) mask[i] = 0;
        if (remove.length) changed = true;
      }
    } while (changed);
    const points = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) points.push({ x: i % SOURCE_SIZE, y: Math.floor(i / SOURCE_SIZE) });
    return points;
  }

  function normalizer(points) {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const point of points) {
      left = Math.min(left, point.x); right = Math.max(right, point.x);
      top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
    }
    const extent = Math.max(right - left, bottom - top);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error("形状を比べられません。一文字書いてから採点してください。");
    const scale = SPAN / extent;
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    // 等方拡大だけで中心・大きさをそろえる。縦横比・傾きは補正しない。
    return point => ({ x: (point.x - cx) * scale + GRID_SIZE / 2, y: (point.y - cy) * scale + GRID_SIZE / 2 });
  }

  function mark(mask, point) {
    const x = Math.round(point.x), y = Math.round(point.y);
    if (x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE) mask[y * GRID_SIZE + x] = 1;
  }

  function referenceGrid(image) {
    const points = skeletonize(imageMask(image));
    const normalize = normalizer(points);
    const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
    for (const point of points) mark(mask, normalize(point));
    return mask;
  }

  function writingGrid(strokes) {
    const normalize = normalizer(strokes.flat());
    const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
    for (const stroke of strokes) {
      let previous = normalize(stroke[0]);
      mark(mask, previous);
      for (const point of stroke.slice(1)) {
        const next = normalize(point);
        // 保存点の密度や筆記速度に依存しないよう、一定間隔で中心線を描く。
        const steps = Math.max(1, Math.ceil(Math.hypot(next.x - previous.x, next.y - previous.y) * 2));
        for (let step = 1; step <= steps; step++) mark(mask, {
          x: previous.x + (next.x - previous.x) * step / steps,
          y: previous.y + (next.y - previous.y) * step / steps,
        });
        previous = next;
      }
    }
    return mask;
  }

  // 8近傍・2パスの距離変換。全点同士の総当たり比較を避ける。
  function distances(mask) {
    const distance = Float32Array.from(mask, value => value ? 0 : GRID_SIZE * 2);
    for (const direction of [1, -1]) {
      for (let row = 0; row < GRID_SIZE; row++) {
        const y = direction === 1 ? row : GRID_SIZE - row - 1;
        for (let column = 0; column < GRID_SIZE; column++) {
          const x = direction === 1 ? column : GRID_SIZE - column - 1;
          const i = y * GRID_SIZE + x;
          const px = x - direction, py = y - direction;
          if (px >= 0 && px < GRID_SIZE) distance[i] = Math.min(distance[i], distance[y * GRID_SIZE + px] + 1);
          if (py < 0 || py >= GRID_SIZE) continue;
          distance[i] = Math.min(distance[i], distance[py * GRID_SIZE + x] + 1);
          for (const dx of [-1, 1]) if (x + dx >= 0 && x + dx < GRID_SIZE) {
            distance[i] = Math.min(distance[i], distance[py * GRID_SIZE + x + dx] + Math.SQRT2);
          }
        }
      }
    }
    return distance;
  }

  function difference(mask, targetDistance) {
    let count = 0, total = 0, unmatched = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) {
      count++;
      const distance = targetDistance[i];
      // 小さなずれは緩やかに、大きな欠損は強めに減点する。
      total += Math.max(0, distance - TOLERANCE) + Math.max(0, distance - 12) ** 2 / 4;
      if (distance > 4) unmatched++;
    }
    return { mean: total / count, unmatched: unmatched / count };
  }

  function evaluate(referenceImage, strokes) {
    const reference = referenceGrid(referenceImage), writing = writingGrid(strokes);
    // 双方向で測り、余分な線だけでなく欠けた線も減点する。
    const extra = difference(writing, distances(reference));
    const missing = difference(reference, distances(writing));
    const mean = (extra.mean + missing.mean) / 2;
    const unmatched = (extra.unmatched + missing.unmatched) / 2;
    const score = Math.round(100 - mean * 4 - unmatched * 15);
    return { version: VERSION, score: Math.max(0, Math.min(100, score)) };
  }

  return { evaluate };
})();
