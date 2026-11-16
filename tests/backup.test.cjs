const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = ["records", "templates", "backup"].map(name => fs.readFileSync(path.join(__dirname, `../js/${name}.js`), "utf8")).join("\n");
const { AppBackup: backup, PracticeRecords: records, CustomTemplates: templates } = vm.runInNewContext(`${source}\n({ AppBackup, PracticeRecords, CustomTemplates });`);
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1kAAAAASUVORK5CYII=";
const template = character => ({ character, image: png, updatedAt: "2026-11-16T00:00:00Z" });
const record = id => ({ id, character: "原", createdAt: "2026-11-16T00:00:00Z", localDate: "2026-11-16", strokes: [[{ x: .1, y: .1 }, { x: .9, y: .9 }]], evaluation: { version: "layout-v1", score: 80, scores: { position: 80, size: 80, balance: 80 }, focus: "大きさ", comment: "少し大きく", stamp: { image: "img/grade3_ganbarimashita.png", label: "がんばりました" } }, reference: { image: png, kind: "image", version: "reference-v1" } });
function memory() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
const json = (savedRecords = [], savedTemplates = [], version = 2) => JSON.stringify({ format: "bimoji-log-backup", version, exportedAt: "2026-11-16T00:00:00Z", records: savedRecords, ...(version === 2 ? { templates: savedTemplates } : {}) });

test("v2に文字名・画像と記録を含め、空の保存先に完全復元する", () => {
  const a = memory(); const original = backup.create(() => a);
  original.records.save(record("a")); original.templates.save(template("原"));
  const exported = original.exportBackup();
  const data = JSON.parse(exported);
  assert.equal(data.version, 2); assert.equal(data.templates[0].image, png);
  const b = memory(); const restored = backup.create(() => b);
  const preview = restored.previewImport(exported);
  assert.equal(preview.records.additions.length, 1); assert.equal(preview.templates.additions.length, 1);
  assert.equal(b.getItem(backup.KEY), null);
  const result = restored.importBackup(exported);
  assert.equal(result.records.added, 1); assert.equal(result.templates.added, 1);
  assert.equal(JSON.stringify(restored.records.read()[0]), JSON.stringify(record("a")));
  assert.equal(JSON.stringify(restored.templates.read()[0]), JSON.stringify(template("原")));
  assert.equal(restored.importBackup(exported).templates.added, 0);
});

test("旧v1ファイルの記録を読み込んでも、既存のお手本を維持する", () => {
  const storage = memory(); const service = backup.create(() => storage);
  service.templates.save(template("原"));
  const result = service.importBackup(json([record("old")], [], 1));
  assert.equal(result.records.added, 1); assert.equal(result.templates.added, 0);
  assert.equal(service.templates.read()[0].character, "原");
});

test("記録0件でもお手本だけを取り込み・再書き出しできる", () => {
  const storage = memory(); const service = backup.create(() => storage);
  service.importBackup(json([], [template("夢")]));
  assert.equal(service.records.read().length, 0);
  assert.equal(JSON.parse(service.exportBackup()).templates[0].character, "夢");
});

test("同じ文字名は画像が同じなら重複、異なるなら内容違いとして既存優先", () => {
  const storage = memory(); const service = backup.create(() => storage);
  service.templates.save(template("原"));
  const sameImage = { ...template("原"), updatedAt: "2026-11-17T00:00:00Z" };
  assert.equal(service.previewImport(json([], [sameImage])).templates.duplicates, 1);
  // 末尾のbase64パディング前へ追加し、形式を保った異なる画像データにする。
  const differentImage = { ...template("原"), image: png.slice(0, -1) + "AAA=" };
  const result = service.importBackup(json([], [differentImage, template("夢")]));
  assert.equal(result.templates.conflicts, 1); assert.equal(result.templates.added, 1);
  assert.equal(service.templates.read().find(item => item.character === "原").image, png);
});

test("お手本が不正なら正常な記録も追加せず、記録が不正ならお手本も追加しない", () => {
  const storage = memory(); const service = backup.create(() => storage);
  const bad = { ...template("原"), character: "原夢" };
  for (const text of [json([record("a")], [bad]), json([{ ...record("a"), strokes: [] }], [template("原")]),
    json([], [template("原"), template("原")]), json([], [], 3), json([]).replace('"templates":[]', '"templates":null')]) {
    assert.throws(() => service.importBackup(text), /読み込めません/);
    assert.equal(storage.getItem(backup.KEY), null);
  }
});

test("統合保存は1回だけ行い、容量不足時は記録もお手本も変えない", () => {
  const storage = memory(); const service = backup.create(() => storage);
  service.records.save(record("old")); service.templates.save(template("原"));
  const before = storage.getItem(backup.KEY); const write = storage.setItem;
  let calls = 0;
  storage.setItem = () => { calls++; const error = new Error(); error.name = "QuotaExceededError"; throw error; };
  assert.throws(() => service.importBackup(json([record("new")], [template("夢")])), /記録もお手本も追加していません/);
  assert.equal(calls, 1); assert.equal(storage.getItem(backup.KEY), before);
  storage.setItem = (key, value) => { calls++; write(key, value); };
  service.importBackup(json([record("new")], [template("夢")]));
  assert.equal(calls, 2); assert.equal(service.records.read().length, 2); assert.equal(service.templates.read().length, 2);
});

test("旧2キーを読み、初回保存成功後にだけ統合・移行する", () => {
  const storage = memory();
  storage.setItem(records.KEY, JSON.stringify({ version: 1, records: [record("old")] }));
  storage.setItem(templates.KEY, JSON.stringify({ version: 1, templates: [template("原")] }));
  const service = backup.create(() => storage);
  assert.equal(service.records.read().length, 1); assert.equal(service.templates.read().length, 1);
  assert.equal(storage.getItem(backup.KEY), null);
  const write = storage.setItem;
  storage.setItem = () => { throw new Error("denied"); };
  assert.throws(() => service.records.save(record("new")));
  assert.ok(storage.getItem(records.KEY)); assert.ok(storage.getItem(templates.KEY));
  storage.setItem = write;
  service.records.save(record("new"));
  assert.equal(storage.getItem(records.KEY), null); assert.equal(storage.getItem(templates.KEY), null);
  assert.equal(service.templates.read()[0].character, "原");
});

test("確認後の保存も維持し、壊れた統合データやお手本を初期化しない", () => {
  const storage = memory(); const service = backup.create(() => storage);
  const incoming = json([record("a")], [template("原")]);
  service.previewImport(incoming);
  service.templates.save(template("原"));
  assert.equal(service.importBackup(incoming).templates.duplicates, 1);
  storage.setItem(backup.KEY, "broken");
  assert.throws(() => service.exportBackup()); assert.throws(() => service.importBackup(incoming));
  assert.equal(storage.getItem(backup.KEY), "broken");
});

test("旧スタンプのパスだけが異なるバックアップは重複として扱う", () => {
  const storage = memory(); const service = backup.create(() => storage);
  service.records.save(record("same"));
  const old = record("same"); old.evaluation.stamp.image = "sozai/grade3_ganbarimashita.png";
  const plan = service.previewImport(json([old]));
  assert.equal(plan.records.duplicates, 1); assert.equal(plan.records.conflicts, 0);
  const oldNew = record("legacy-new"); oldNew.evaluation.stamp.image = "sozai/grade3_ganbarimashita.png";
  assert.equal(service.importBackup(json([oldNew])).records.added, 1);
  assert.equal(service.records.read().find(item => item.id === "legacy-new").evaluation.stamp.image, "img/grade3_ganbarimashita.png");
});
