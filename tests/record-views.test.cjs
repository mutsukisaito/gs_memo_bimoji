const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 表示要素の契約だけを確認する。レイアウトと実際のCanvas描画はブラウザで検証する。
function load() {
  const drawings = [];
  const document = { createElement(tag) {
    return { tag, children: [], attributes: {}, events: {},
      append(...items) { this.children.push(...items); },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { this.events[name] = handler; },
    };
  } };
  const views = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../js/record-views.js'), 'utf8')}\nRecordViews;`, {
    document, CanvasDrawing: { paintStrokes: (canvas, strokes) => drawings.push({ canvas, strokes }) },
  });
  return { views, drawings };
}
function record(id, score = 80) {
  return { id, character: '原', createdAt: '2026-11-16T00:00:00Z', strokes: [[{ x: 0.2, y: 0.3 }]],
    reference: { image: 'same' }, evaluation: { score, version: 'layout-v1' } };
}

test('記録カードには日時・点数・筆跡を表示し、押すとそのIDを通知する', () => {
  const { views, drawings } = load();
  let opened;
  const saved = record('chosen', 93);
  const card = views.createRecordCard(saved, id => { opened = id; });
  assert.equal(card.children[1].children[0].textContent, '原 · 93点');
  assert.equal(card.children[1].children[1].dateTime, saved.createdAt);
  assert.equal(drawings[0].strokes, saved.strokes);
  assert.equal(drawings[0].canvas.width, 240);
  card.events.click();
  assert.equal(opened, 'chosen');
});

test('比較には最初と最高点を使い、最新を使わず、見出しを繰り返さない', () => {
  const { views, drawings } = load();
  const first = record('first', 40), best = record('best', 95), latest = record('latest', 60);
  const card = views.createComparisonCard({ character: '原', first, best, latest });
  assert.equal(card.children.length, 1);
  assert.equal(drawings[0].strokes, first.strokes);
  assert.equal(drawings[1].strokes, best.strokes);
  assert.equal(card.children[0].children[0].children[0].tag, 'canvas');
  assert.equal(card.children[0].children[1].children[1].children[0].textContent, '95点');
});

test('比較対象のお手本か採点方式が違う場合だけ注記を出す', () => {
  const { views } = load();
  const first = record('first'), best = record('best');
  for (const change of [() => { best.reference.image = 'different'; }, () => { best.reference.image = 'same'; best.evaluation.version = 'v2'; }]) {
    change();
    const card = views.createComparisonCard({ character: '原', first, best });
    assert.equal(card.children[1].className, 'comparison-note');
  }
});
