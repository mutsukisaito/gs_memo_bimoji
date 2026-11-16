const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const engine = vm.runInNewContext(`${fs.readFileSync(require("node:path").join(__dirname, "../js/evaluation.js"), "utf8")}\nHandwritingEvaluation;`);
const reference = { x: 0.5, y: 0.5, width: 0.6, height: 0.7 };

test("お手本と同じ配置は100点・肯定コメント・最高評価スタンプ", () => {
  const result = engine.evaluate(reference, reference);
  assert.equal(result.score, 100);
  assert.equal(result.focus, "良かったところ");
  assert.equal(result.stamp.minimum, 85);
});

test("上下左右のずれを検出し、逆方向への助言を出す", () => {
  for (const [key, delta, direction, correction] of [["x", 0.2, "右", "左"], ["x", -0.2, "左", "右"], ["y", 0.2, "下", "上"], ["y", -0.2, "上", "下"]]) {
    const result = engine.evaluate(reference, { ...reference, [key]: 0.5 + delta });
    assert.ok(result.scores.position < 100);
    assert.equal(result.scores.size, 100);
    assert.equal(result.scores.balance, 100);
    assert.ok(result.comment.includes(`${direction}に寄って`));
    assert.ok(result.comment.includes(`少し${correction}に`));
  }
});

test("縦横比を保つ拡大・縮小には大きさの助言を出す", () => {
  for (const scale of [0.5, 1.3]) {
    const result = engine.evaluate(reference, { ...reference, width: reference.width * scale, height: reference.height * scale });
    assert.equal(result.scores.position, 100);
    assert.equal(result.scores.balance, 100);
    assert.ok(result.scores.size < 100);
    assert.ok(result.comment.includes(scale < 1 ? "小さめ" : "大きめ"));
  }
});

test("同じ面積でも横長・縦長の違いを検出する", () => {
  for (const scale of [0.7, 1.4]) {
    const result = engine.evaluate(reference, { ...reference, width: reference.width * scale, height: reference.height / scale });
    assert.equal(result.scores.size, 100);
    assert.ok(result.scores.balance < 100);
    assert.ok(result.comment.includes(scale < 1 ? "縦長" : "横長"));
  }
});

test("差を増やすと点数が下がり、すべての点数が0〜100に収まる", () => {
  let previous = 101;
  for (const dx of [0, 0.05, 0.15, 0.3, 0.5]) {
    const result = engine.evaluate(reference, { ...reference, x: reference.x + dx });
    assert.ok(result.score <= previous);
    previous = result.score;
    for (const score of [result.score, ...Object.values(result.scores)]) assert.ok(score >= 0 && score <= 100);
  }
  assert.equal(engine.evaluate(reference, { x: 0, y: 0, width: 0.04, height: 0.8 }).stamp.minimum, 0);
});

test("未入力・点だけ・空のお手本は採点結果を作らない", () => {
  assert.throws(() => engine.evaluate(reference, null), /一文字/);
  assert.throws(() => engine.evaluate(reference, { x: 0.5, y: 0.5, width: 0.013, height: 0.013 }), /点だけ/);
  assert.throws(() => engine.evaluate(null, reference), /お手本/);
});

function inkImage(size, whiteBackground) {
  const data = new Uint8ClampedArray(size * size * 4);
  if (whiteBackground) data.fill(255);
  for (let y = size * 0.2; y < size * 0.8; y++) {
    for (let x = size * 0.3; x < size * 0.7; x++) {
      const offset = (y * size + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 0;
      data[offset + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

test("白背景・透過背景・異なる解像度でも同じ正規化範囲を取得する", () => {
  const expected = JSON.stringify(engine.inspectInk(inkImage(100, false)));
  for (const size of [100, 200]) {
    for (const white of [true, false]) assert.equal(JSON.stringify(engine.inspectInk(inkImage(size, white))), expected);
  }
  const empty = { width: 10, height: 10, data: new Uint8ClampedArray(400) };
  assert.equal(engine.inspectInk(empty), null);
  empty.data.fill(255);
  assert.equal(engine.inspectInk(empty), null);
});
