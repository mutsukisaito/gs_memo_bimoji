const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/canvas-drawing.js'), 'utf8');

function canvas(width = 1000) {
  const calls = [];
  const context = {};
  for (const name of ['clearRect', 'beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke', 'putImageData', 'drawImage']) {
    context[name] = (...args) => calls.push([name, ...args]);
  }
  return { width, height: width, calls, context, getContext: () => context };
}
function load(mask = canvas()) {
  return vm.runInNewContext(`${source}\nCanvasDrawing;`, {
    document: { createElement: () => mask },
    ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
  });
}

test('表示サイズから0〜1の座標へ変換し、枠外の入力を枠内に収める', () => {
  const drawing = load();
  const paper = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 400 }) };
  assert.equal(JSON.stringify(drawing.pointFromEvent(paper, { clientX: 110, clientY: 120 })), '{"x":0.5,"y":0.25}');
  assert.equal(JSON.stringify(drawing.pointFromEvent(paper, { clientX: -50, clientY: 500 })), '{"x":0,"y":1}');
});

test('描画と履歴の再描画で、線の座標・太さ・点の半径が一致する', () => {
  const drawing = load();
  for (const width of [240, 400, 1000]) {
    const input = canvas(width), saved = canvas(width);
    const from = { x: 0.2, y: 0.3 }, to = { x: 0.8, y: 0.9 };
    drawing.drawSegment(input, null, from);
    drawing.drawSegment(input, from, to);
    drawing.paintStrokes(saved, [[from, to]]);
    assert.deepEqual(saved.calls.slice(1), input.calls);
    assert.equal(saved.context.lineWidth, width * 0.013);
    assert.equal(saved.calls.find(call => call[0] === 'arc')[3], width * 0.0065);
    assert.deepEqual(saved.calls.find(call => call[0] === 'lineTo'), ['lineTo', width * 0.8, width * 0.9]);
  }
});

test('複数画の始点を分離し、点だけの画も残す。元の座標は変更しない', () => {
  const drawing = load(), paper = canvas();
  const strokes = [[{ x: 0.1, y: 0.2 }], [{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.6 }]];
  const before = JSON.stringify(strokes);
  drawing.paintStrokes(paper, strokes);
  assert.equal(paper.calls.filter(call => call[0] === 'arc').length, 2);
  assert.equal(paper.calls.filter(call => call[0] === 'stroke').length, 1);
  assert.equal(JSON.stringify(strokes), before);
});

test('白・透過の背景は消し、黒いお手本は30%の濃さにする。元画像を変更しない', () => {
  const mask = canvas(), target = canvas(1000), drawing = load(mask);
  const data = new Uint8ClampedArray([0,0,0,255, 255,255,255,255, 0,0,0,0]);
  const before = [...data];
  drawing.paintReferenceOverlay({ data, width: 3, height: 1 }, target);
  const result = mask.calls.find(call => call[0] === 'putImageData')[1];
  assert.deepEqual([...result.data], [70,70,70,77, 70,70,70,0, 70,70,70,0]);
  assert.deepEqual([...data], before);
  assert.deepEqual(target.calls[0], ['clearRect', 0, 0, 1000, 1000]);
});
