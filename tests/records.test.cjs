const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const records = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, "../js/records.js"), "utf8")}\nPracticeRecords;`);

function mockStorage() {
  const items = new Map();
  return {
    getItem: key => items.has(key) ? items.get(key) : null,
    setItem: (key, value) => items.set(key, value),
  };
}

function record(id = "first", createdAt = "2026-11-15T12:00:00.000Z") {
  return {
    id, character: "原", createdAt, localDate: "2026-11-15",
    strokes: [[{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }], [{ x: 0.3, y: 0.3 }]],
    evaluation: {
      version: "layout-v1", score: 80, scores: { position: 90, size: 80, balance: 70 },
      focus: "次は、大きさを意識", comment: "もう少し大きく書いてみましょう。",
      stamp: { image: "img/grade3_ganbarimashita.png", label: "がんばりました", minimum: 60 },
    },
    reference: {
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1kAAAAASUVORK5CYII=",
      kind: "font", version: "reference-v1", fontFamily: "serif", source: null,
    },
  };
}

test("保存先が空なら0件。新しいストアでも筆跡・お手本・評価を完全に復元する", () => {
  const storage = mockStorage();
  const store = records.createStore(() => storage);
  assert.equal(store.read().length, 0);
  const original = record();
  store.save(original);
  const restored = records.createStore(() => storage).read();
  assert.equal(JSON.stringify(restored[0]), JSON.stringify(original));
});

test("保存の連打でも重複せず、日時の新しい順に並ぶ", () => {
  const mock = mockStorage();
  const store = records.createStore(() => mock);
  store.save(record("old"));
  store.save(record("new", "2026-11-16T12:00:00.000Z"));
  store.save(record("old"));
  assert.equal(store.read().map(item => item.id).join(","), "new,old");
});

test("別ストアで追加した記録を維持し、指定IDだけ削除する", () => {
  const storage = mockStorage();
  const firstTab = records.createStore(() => storage);
  const secondTab = records.createStore(() => storage);
  firstTab.save(record("a"));
  secondTab.save(record("b"));
  firstTab.remove("a");
  assert.equal(secondTab.read().map(item => item.id).join(","), "b");
  firstTab.remove("missing");
  assert.equal(firstTab.read().length, 1);
  secondTab.remove("b");
  assert.equal(firstTab.read().length, 0);
});

test("容量不足で保存に失敗しても既存データは変わらず、再試行できる", () => {
  const storage = mockStorage();
  const store = records.createStore(() => storage);
  store.save(record("existing"));
  const before = storage.getItem(records.KEY);
  const setItem = storage.setItem;
  storage.setItem = () => { const error = new Error(); error.name = "QuotaExceededError"; throw error; };
  assert.throws(() => store.save(record("new")), /保存容量/);
  assert.equal(storage.getItem(records.KEY), before);
  storage.setItem = setItem;
  store.save(record("new"));
  assert.equal(store.read().length, 2);
});

test("壊れたデータ・未知の形式・不正な筆跡を上書きも削除もしない", () => {
  const storage = mockStorage();
  const store = records.createStore(() => storage);
  const invalid = record();
  invalid.strokes[0][0].x = 2;
  const duplicate = record();
  for (const raw of ["{broken", "null", JSON.stringify({ version: 2, records: [] }),
    JSON.stringify({ version: 1, records: [invalid] }), JSON.stringify({ version: 1, records: [duplicate, duplicate] })]) {
    storage.setItem(records.KEY, raw);
    assert.throws(() => store.read(), /既存データを保護/);
    assert.throws(() => store.save(record("new")), /既存データを保護/);
    assert.throws(() => store.remove("first"), /既存データを保護/);
    assert.equal(storage.getItem(records.KEY), raw);
  }
});

test("アクセス禁止や削除書き込み失敗でも例外を画面用メッセージにする", () => {
  const blocked = records.createStore(() => { throw new Error("SecurityError"); });
  assert.throws(() => blocked.read(), /読み込めません/);
  const storage = mockStorage();
  const store = records.createStore(() => storage);
  store.save(record());
  const before = storage.getItem(records.KEY);
  storage.setItem = () => { throw new Error("denied"); };
  assert.throws(() => store.remove("first"), /保存できません/);
  assert.equal(storage.getItem(records.KEY), before);
});

test("不正な新規記録を保存せず、空の保存先も変更しない", () => {
  const storage = mockStorage();
  const store = records.createStore(() => storage);
  const invalid = record();
  invalid.evaluation.score = NaN;
  assert.throws(() => store.save(invalid), /形式/);
  assert.equal(storage.getItem(records.KEY), null);
});

test("練習日付をUTC変換せず、ローカル日付から作る", () => {
  const local = new Date(2026, 10, 16, 0, 5);
  assert.equal(records.localDate(local), "2026-11-16");
});

test("記録0件では練習数・日数とも0で比較対象もない", () => {
  const summary = records.summarize([]);
  assert.equal(summary.practiceCount, 0);
  assert.equal(summary.practiceDays, 0);
  assert.equal(summary.characters.length, 0);
  assert.equal(records.latestFor([], "原"), null);
});

test("同日複数回は1日、UTC日付ではなく保存時のローカル日付で数える", () => {
  const a = record("a", "2026-11-15T14:59:00Z");
  const b = record("b", "2026-11-15T15:01:00Z");
  const c = record("c", "2026-11-16T02:00:00Z");
  b.localDate = c.localDate = "2026-11-16";
  const summary = records.summarize([a, b, c]);
  assert.equal(summary.practiceCount, 3);
  assert.equal(summary.practiceDays, 2);
});

test("順不同の記録から文字ごとの最初と最新を選び、元配列は変えない", () => {
  const first = record("first", "2026-11-13T12:00:00Z");
  const latest = record("latest", "2026-11-16T12:00:00Z");
  const middle = record("middle", "2026-11-14T12:00:00Z");
  const other = record("other", "2026-11-17T12:00:00Z");
  other.character = "夢";
  const input = [middle, other, latest, first];
  const originalOrder = input.map(item => item.id).join();
  const summary = records.summarize(input);
  const group = summary.characters.find(item => item.character === "原");
  assert.equal(group.first.id, "first");
  assert.equal(group.latest.id, "latest");
  assert.equal(group.count, 3);
  assert.equal(records.latestFor(input, "原").id, "latest");
  assert.equal(records.latestFor(input, "福"), null);
  assert.equal(input.map(item => item.id).join(), originalOrder);
});

test("最高点は文字ごとに選び、同点では新しい日時・保存順を優先する", () => {
  const first = record("first", "2026-11-13T12:00:00Z");
  const best = record("best", "2026-11-14T12:00:00Z"); best.evaluation.score = 95;
  const latest = record("latest", "2026-11-16T12:00:00Z");
  const other = record("other"); other.character = "夢"; other.evaluation.score = 100;
  const input = [latest, other, best, first];
  const group = records.summarize(input).characters.find(item => item.character === "原");
  assert.equal(group.first.id, "first");
  assert.equal(group.best.id, "best");
  assert.equal(group.latest.id, "latest");
  assert.equal(input.map(item => item.id).join(), "latest,other,best,first");
  latest.evaluation.score = 95;
  assert.equal(records.summarize(input).characters.find(item => item.character === "原").best.id, "latest");
  assert.equal(records.summarize([record("new"), record("old")]).characters[0].best.id, "new");
  assert.equal(records.summarize([best]).characters[0].best.id, "best");
  first.evaluation.score = 100;
  assert.equal(records.summarize(input).characters.find(item => item.character === "原").best.id, "first");
});

test("削除すると日数・件数・最初と最新・前回コメントの対象を再集計する", () => {
  const first = record("first", "2026-11-13T12:00:00Z");
  first.localDate = "2026-11-13";
  const latest = record("latest");
  const storage = mockStorage();
  const store = records.createStore(() => storage);
  store.save(first); store.save(latest);
  assert.equal(records.summarize(store.read()).practiceDays, 2);
  store.remove("latest");
  const summary = records.summarize(store.read());
  assert.equal(summary.practiceCount, 1);
  assert.equal(summary.practiceDays, 1);
  assert.equal(summary.characters[0].first.id, "first");
  assert.equal(summary.characters[0].latest.id, "first");
  assert.equal(summary.characters[0].best.id, "first");
  assert.equal(records.latestFor(store.read(), "原").id, "first");
  store.remove("first");
  assert.equal(records.latestFor(store.read(), "原"), null);
  assert.equal(records.summarize(store.read()).practiceDays, 0);
});

test("日時が同じ記録は最新の保存が先にある配列順で区別する", () => {
  const summary = records.summarize([record("new"), record("old")]);
  assert.equal(summary.characters[0].latest.id, "new");
  assert.equal(summary.characters[0].first.id, "old");
});

const backup = items => JSON.stringify({ format: "bimoji-log-backup", version: 1, exportedAt: "2026-11-16T00:00:00Z", records: items });

test("書き出しを別ストアに読み込み、筆跡・評価・当時のお手本を復元できる", () => {
  const originalStorage = mockStorage();
  const source = records.createStore(() => originalStorage);
  const destinationStorage = mockStorage();
  const destination = records.createStore(() => destinationStorage);
  source.save(record("a")); source.save(record("b"));
  const json = source.exportBackup();
  const exported = JSON.parse(json);
  assert.equal(exported.format, "bimoji-log-backup");
  assert.equal(exported.version, 1);
  assert.ok(Number.isFinite(Date.parse(exported.exportedAt)));
  assert.equal(destination.previewImport(json).additions.length, 2);
  assert.equal(destinationStorage.getItem(records.KEY), null, "確認だけでは変更しない");
  assert.equal(destination.importBackup(json).added, 2);
  for (const item of source.read()) assert.equal(JSON.stringify(destination.read().find(saved => saved.id === item.id)), JSON.stringify(item));
  assert.equal(destination.importBackup(json).added, 0);
  assert.equal(destination.read().length, 2);
});

test("既存を保持して新しいIDだけ追加、同一IDの内容違いを上書きしない", () => {
  const storage = mockStorage(); const store = records.createStore(() => storage);
  const existing = record("existing"); store.save(existing);
  const conflict = record("existing"); conflict.evaluation.comment = "別のコメント";
  const result = store.importBackup(backup([conflict, record("new")]));
  assert.equal(result.added, 1); assert.equal(result.conflicts, 1);
  assert.equal(store.read().find(item => item.id === "existing").evaluation.comment, existing.evaluation.comment);
  const reordered = Object.fromEntries(Object.entries(existing).reverse());
  assert.equal(store.previewImport(backup([reordered])).duplicates, 1);
});

test("確認後の別タブでの追加も考慮し、追加件数を再計算する", () => {
  const storage = mockStorage(); const first = records.createStore(() => storage);
  const second = records.createStore(() => storage);
  const json = backup([record("a"), record("b")]);
  assert.equal(first.previewImport(json).additions.length, 2);
  second.save(record("a"));
  const result = first.importBackup(json);
  assert.equal(result.added, 1); assert.equal(result.duplicates, 1);
  assert.equal(first.read().length, 2);
});

test("不正JSON・未知形式・ID重複・不正な点数や日付は1件も取り込まない", () => {
  const storage = mockStorage(); const store = records.createStore(() => storage);
  store.save(record("existing")); const before = storage.getItem(records.KEY);
  const invalidScore = record("bad"); invalidScore.evaluation.score = 101;
  const invalidDate = record("bad"); invalidDate.localDate = "2026-02-30";
  const invalidPoint = record("bad"); invalidPoint.strokes[0][0].x = -0.1;
  for (const json of ["broken", "null", "[]", "{}", JSON.stringify({ version: 2, records: [] }),
    backup([record("a"), record("a")]), backup([record("a"), invalidScore]), backup([invalidDate]), backup([invalidPoint])]) {
    assert.throws(() => store.previewImport(json), /読み込めません/);
    assert.throws(() => store.importBackup(json), /読み込めません/);
    assert.equal(storage.getItem(records.KEY), before);
  }
});

test("取り込み時の容量不足では既存データを維持し、再試行で一括追加する", () => {
  const storage = mockStorage(); const store = records.createStore(() => storage);
  store.save(record("existing")); const before = storage.getItem(records.KEY);
  const originalSet = storage.setItem;
  storage.setItem = () => { const error = new Error(); error.name = "QuotaExceededError"; throw error; };
  const json = backup([record("a"), record("b")]);
  assert.throws(() => store.importBackup(json), /保存容量/);
  assert.equal(storage.getItem(records.KEY), before);
  storage.setItem = originalSet;
  assert.equal(store.importBackup(json).added, 2);
});

test("0件の書き出し・読み込み、BOM付きJSONを扱える", () => {
  const storage = mockStorage(); const store = records.createStore(() => storage);
  const json = store.exportBackup();
  assert.equal(JSON.parse(json).records.length, 0);
  assert.equal(store.importBackup(json).added, 0);
  assert.equal(storage.getItem(records.KEY), null);
  assert.equal(store.importBackup(`\uFEFF${backup([record()])}`).added, 1);
});

test("既存データが壊れていたら書き出し・読み込みで上書きしない", () => {
  const storage = mockStorage(); storage.setItem(records.KEY, "broken");
  const store = records.createStore(() => storage);
  assert.throws(() => store.exportBackup(), /既存データを保護/);
  assert.throws(() => store.importBackup(backup([record()])), /既存データを保護/);
  assert.equal(storage.getItem(records.KEY), "broken");
});

test("サイズ上限を超える読み込みは保存データを変更しない", () => {
  const storage = mockStorage(); const store = records.createStore(() => storage);
  const huge = " ".repeat(records.MAX_BACKUP_BYTES + 1);
  assert.throws(() => store.importBackup(huge), /10MB/);
  assert.equal(storage.getItem(records.KEY), null);
});

test("4種類の表示順で並べ替え、元配列・点数・日時を変更しない", () => {
  const a = record("a", "2026-11-13T00:00:00Z"); a.evaluation.score = 90;
  const b = record("b", "2026-11-14T00:00:00Z"); b.evaluation.score = 40;
  const c = record("c", "2026-11-15T00:00:00Z"); c.evaluation.score = 60;
  const input = [b, a, c]; const before = JSON.stringify(input);
  for (const [order, expected] of [["date-desc", "c,b,a"], ["date-asc", "a,b,c"], ["score-desc", "a,c,b"], ["score-asc", "b,c,a"]]) {
    assert.equal(records.sortRecords(input, order).map(item => item.id).join(), expected);
    assert.equal(JSON.stringify(input), before);
  }
});

test("同点は新しい日付が先、同点同日時なら元の並びを保つ", () => {
  const old = record("old", "2026-11-13T00:00:00Z");
  const newer = record("newer"); const sameTime = record("sameTime");
  for (const order of ["score-desc", "score-asc"]) {
    assert.equal(records.sortRecords([old, newer, sameTime], order).map(item => item.id).join(), "newer,sameTime,old");
  }
});

test("文字の絞り込みと並べ替えを組み合わせても成長比較の最初・最新は変わらない", () => {
  const first = record("first", "2026-11-13T00:00:00Z"); first.evaluation.score = 99;
  const latest = record("latest"); latest.evaluation.score = 10;
  const other = record("other"); other.character = "夢";
  const sorted = records.sortRecords([first, latest, other].filter(item => item.character === "原"), "score-desc");
  assert.equal(sorted.map(item => item.id).join(), "first,latest");
  const summary = records.summarize(sorted);
  assert.equal(summary.characters[0].first.id, "first");
  assert.equal(summary.characters[0].latest.id, "latest");
});

test("空・1件・不明な並べ替えと、タイムゾーンの異なる日時を扱う", () => {
  assert.equal(records.sortRecords([], "score-desc").length, 0);
  assert.equal(records.sortRecords([record("only")], "date-asc")[0].id, "only");
  const earlier = record("earlier", "2026-11-16T08:00:00+09:00");
  const later = record("later", "2026-11-16T00:00:00Z");
  assert.equal(records.sortRecords([earlier, later], "unknown").map(item => item.id).join(), "later,earlier");
});

test("以前保存したスタンプのパスをimgへ読み替え、元の保存データは変更しない", () => {
  const storage = mockStorage(); const store = records.createStore(() => storage);
  const names = ["grade1_taihenyoku.png", "grade3_ganbarimashita.png", "grade4_mousukoshi.png"];
  const legacy = names.map(name => { const item = record(name); item.evaluation.stamp.image = `sozai/${name}`; return item; });
  const raw = JSON.stringify({ version: 1, records: legacy });
  storage.setItem(records.KEY, raw);
  for (const item of store.read()) assert.equal(item.evaluation.stamp.image, `img/${item.id}`);
  assert.equal(storage.getItem(records.KEY), raw);
  assert.ok(JSON.parse(store.exportBackup()).records.every(item => item.evaluation.stamp.image.startsWith("img/")));
});

test("形状点を保存・再読込でき、旧記録は未採点のまま保つ", () => {
  const storage = mockStorage(), store = records.createStore(() => storage);
  const saved = record("shape");
  saved.evaluation.shape = { version: "shape-v1", score: 73 };
  store.save(saved); store.save(record("old"));
  const reopened = records.createStore(() => storage);
  assert.equal(reopened.read().find(item => item.id === "shape").evaluation.shape.score, 73);
  assert.equal(reopened.read().find(item => item.id === "shape").evaluation.score, 80);
  assert.equal(reopened.read().find(item => item.id === "old").evaluation.shape, undefined);
});

test("不正な形状点は保存せず、既存の記録も変更しない", () => {
  const storage = mockStorage(), store = records.createStore(() => storage);
  store.save(record("existing"));
  for (const invalid of [null, {}, { version: "", score: 50 }, { version: "shape-v1", score: -1 },
    { version: "shape-v1", score: 101 }, { version: "shape-v1", score: 4.5 }, { version: "shape-v1", score: "80" }]) {
    const saved = record("invalid"); saved.evaluation.shape = invalid;
    assert.throws(() => store.save(saved), /形式/);
    assert.equal(store.read().length, 1);
  }
});
