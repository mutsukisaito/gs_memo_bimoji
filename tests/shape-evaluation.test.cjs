const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const shape = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../js/shape-evaluation.js'), 'utf8')}\nShapeEvaluation;`);
const square = [[{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }, { x: .2, y: .2 }]];
const middle = [{ x: .2, y: .5 }, { x: .8, y: .5 }];

// Canvasに依存しない画像を用意し、線幅以外の条件をそろえて比較する。
function image(strokes, thickness = 5, size = 192, white = false) {
  const data = new Uint8ClampedArray(size * size * 4);
  if (white) data.fill(255);
  for (const stroke of strokes) {
    for (let k = 0; k < Math.max(1, stroke.length - 1); k++) {
      const a = stroke[k], b = stroke[k + 1] || a;
      const length = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * size * 2));
      for (let i = 0; i <= length; i++) {
        const cx = (a.x + (b.x - a.x) * i / length) * size;
        const cy = (a.y + (b.y - a.y) * i / length) * size;
        const radius = thickness / 2;
        for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(size - 1, Math.ceil(cy + radius)); y++) {
          for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(size - 1, Math.ceil(cx + radius)); x++) {
            if (Math.hypot(x - cx, y - cy) > radius) continue;
            const offset = (y * size + x) * 4;
            data[offset] = data[offset + 1] = data[offset + 2] = 0;
            data[offset + 3] = 255;
          }
        }
      }
    }
  }
  return { width: size, height: size, data };
}
const transform = (strokes, fn) => strokes.map(stroke => stroke.map(fn));

test('同じ形の中心線は高得点になる。結果は0〜100の整数と方式ID', () => {
  const result = shape.evaluate(image(square), square);
  assert.ok(result.score >= 95, result.score);
  assert.equal(result.version, 'shape-v1');
  assert.ok(Number.isInteger(result.score));
});

test('線幅を変えても同じ形なら高得点を保つ', () => {
  const scores = [3, 7, 13].map(width => shape.evaluate(image(square, width), square).score);
  assert.ok(Math.min(...scores) >= 93, scores.join());
  assert.ok(Math.max(...scores) - Math.min(...scores) <= 6, scores.join());
});

test('中心・全体の大きさをそろえ、移動・等方拡大縮小で点数を変えない', () => {
  const reference = image(square);
  const expected = shape.evaluate(reference, square).score;
  for (const factor of [.4, .7, 1.1]) {
    const moved = transform(square, point => ({ x: .1 + point.x * factor, y: .05 + point.y * factor }));
    assert.ok(Math.abs(shape.evaluate(reference, moved).score - expected) <= 1);
  }
});

test('横長への変形や回転は自動補正せず減点する', () => {
  const reference = image(square);
  const wide = transform(square, point => ({ x: point.x, y: .5 + (point.y - .5) * .5 }));
  const rotated = transform(square, point => ({ x: .5 + (point.x - point.y) * Math.SQRT1_2, y: .5 + (point.x + point.y - 1) * Math.SQRT1_2 }));
  assert.ok(shape.evaluate(reference, wide).score < 70);
  assert.ok(shape.evaluate(reference, rotated).score < 70);
});

test('お手本の一部分だけを書いた場合と、余分な線がある場合を両方減点する', () => {
  const withMiddle = [...square, middle];
  const correct = shape.evaluate(image(withMiddle), withMiddle).score;
  const missing = shape.evaluate(image(withMiddle), square).score;
  const extra = shape.evaluate(image(square), withMiddle).score;
  assert.ok(missing < correct - 15, `${correct},${missing}`);
  assert.ok(extra < 85, extra);
});

test('同じ外形でも内側の線が異なる字の一致度を下げる', () => {
  const reference = image([...square, middle]);
  const vertical = [...square, [{ x: .5, y: .2 }, { x: .5, y: .8 }]];
  assert.ok(shape.evaluate(reference, vertical).score < shape.evaluate(reference, [...square, middle]).score - 15);
});

test('座標の密度・逆向きの筆記・画の順序・同じ線の重ね書きで点数を変えない', () => {
  const strokes = [...square, middle], reference = image(strokes);
  const dense = strokes.map(stroke => stroke.flatMap((point, index) => {
    const next = stroke[index + 1];
    return next ? [point, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }] : [point];
  }));
  const expected = shape.evaluate(reference, strokes).score;
  for (const equivalent of [dense, strokes.map(stroke => [...stroke].reverse()).reverse(), [...strokes, ...strokes]]) {
    assert.ok(Math.abs(shape.evaluate(reference, equivalent).score - expected) <= 1);
  }
});

test('白背景・透過背景・解像度差でも形を比較でき、入力を変更しない', () => {
  const strokes = [...square, middle];
  const original = JSON.stringify(strokes);
  for (const size of [192, 600]) {
    const reference = image(strokes, size / 40, size, true);
    const before = Buffer.from(reference.data);
    assert.ok(shape.evaluate(reference, strokes).score >= 90);
    assert.deepEqual(Buffer.from(reference.data), before);
  }
  assert.equal(JSON.stringify(strokes), original);
});

test('空のお手本・空の筆跡・1点だけでは結果を作らない', () => {
  assert.throws(() => shape.evaluate(image([]), square), /形状/);
  assert.throws(() => shape.evaluate(image(square), []), /形状/);
  assert.throws(() => shape.evaluate(image(square), [[{ x: .5, y: .5 }]]), /形状/);
});

test('手書き書体にある端の突き出し・わずかな傾きだけで極端な低得点にしない', () => {
  const fontLikeBox = [
    [{ x: .2, y: .18 }, { x: .23, y: .84 }],
    [{ x: .21, y: .22 }, { x: .8, y: .18 }, { x: .76, y: .76 }],
    [{ x: .23, y: .77 }, { x: .79, y: .75 }],
  ];
  const result = shape.evaluate(image(fontLikeBox), square);
  assert.ok(result.score >= 55 && result.score < 95, result.score);
});
