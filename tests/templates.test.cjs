const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = ["font-characters", "templates"].map(name => fs.readFileSync(path.join(__dirname, `../js/${name}.js`), "utf8")).join("\n");
const templates = vm.runInNewContext(`${source}\nCustomTemplates;`);
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1kAAAAASUVORK5CYII=";
const item = character => ({ character, image: png, updatedAt: "2026-11-16T00:00:00Z" });
function memory() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}

test("文字名は前後の空白を除き、1文字を検証する", () => {
  assert.equal(templates.normalizeCharacter(" 原 "), "原");
  assert.equal(templates.normalizeCharacter("か\u3099"), "が");
  assert.equal(templates.normalizeCharacter("𠮷"), "𠮷");
  for (const name of ["", " ", "美文字", "あ い"]) assert.throws(() => templates.normalizeCharacter(name), /1文字/);
});

test("保存・再読み込み・個別削除で画像と文字名を維持する", () => {
  const storage = memory(); const store = templates.createStore(() => storage);
  assert.equal(store.read().length, 0);
  store.save(item("原")); store.save(item("夢"));
  const reloaded = templates.createStore(() => storage);
  assert.equal(reloaded.read().length, 2);
  assert.equal(JSON.stringify(reloaded.read()[1]), JSON.stringify(item("原")));
  reloaded.remove("夢");
  assert.equal(reloaded.read()[0].character, "原");
  reloaded.remove("not-exists");
  assert.equal(reloaded.read().length, 1);
});

test("同じ文字は確認がなければ置換せず、確認後は1件のまま更新する", () => {
  const storage = memory(); const store = templates.createStore(() => storage);
  store.save(item("原")); const before = storage.getItem(templates.KEY);
  const updated = { ...item("原"), updatedAt: "2026-11-17T00:00:00Z" };
  assert.throws(() => store.save(updated), /登録済み/);
  assert.equal(storage.getItem(templates.KEY), before);
  store.save(updated, true);
  assert.equal(store.read().length, 1);
  assert.equal(store.read()[0].updatedAt, updated.updatedAt);
});

test("不正な文字・画像・日時・容量を保存しない", () => {
  const storage = memory(); const store = templates.createStore(() => storage);
  for (const bad of [{ ...item("原"), character: "原夢" }, { ...item("原"), image: "https://example.com/a.png" },
    { ...item("原"), image: "data:image/svg+xml;base64,AA==" }, { ...item("原"), updatedAt: "invalid" },
    { ...item("原"), image: png + "A".repeat(templates.MAX_IMAGE_LENGTH) }]) {
    assert.throws(() => store.save(bad));
    assert.equal(storage.getItem(templates.KEY), null);
  }
});

test("容量不足・書き込み禁止時も既存のお手本や記録を変更しない", () => {
  const storage = memory(); const store = templates.createStore(() => storage);
  storage.setItem("bimoji.records.v1", "records-untouched");
  store.save(item("原")); const before = storage.getItem(templates.KEY);
  storage.setItem = () => { const error = new Error(); error.name = "QuotaExceededError"; throw error; };
  assert.throws(() => store.save(item("夢")), /容量/);
  assert.throws(() => store.remove("原"), /容量/);
  assert.equal(storage.getItem(templates.KEY), before);
  assert.equal(storage.getItem("bimoji.records.v1"), "records-untouched");
});

test("壊れたデータや重複のある保存先を上書きしない", () => {
  const storage = memory(); const store = templates.createStore(() => storage);
  for (const raw of ["broken", "null", JSON.stringify({ version: 2, templates: [] }), JSON.stringify({ version: 1, templates: [item("原"), item("原")] })]) {
    storage.setItem(templates.KEY, raw);
    assert.throws(() => store.read(), /保護/);
    assert.throws(() => store.save(item("夢")), /保護/);
    assert.throws(() => store.remove("原"), /保護/);
    assert.equal(storage.getItem(templates.KEY), raw);
  }
});

test("ストレージを使えない場合は利用設定を案内する", () => {
  const store = templates.createStore(() => { throw new Error("denied"); });
  assert.throws(() => store.read(), /利用設定/);
});

test("文字名だけの追加はKlee Oneを指定し、再読み込み後も画像なしで維持する", () => {
  const storage = memory(), store = templates.createStore(() => storage);
  const font = templates.createFont(" 愛 ", [{ character: "原" }], store.read());
  assert.equal(font.character, "愛");
  assert.equal(font.kind, "font");
  assert.equal(font.fontFamily, "Klee One");
  assert.equal(font.image, undefined);
  store.save(font);
  const restored = templates.createStore(() => storage).read()[0];
  assert.equal(JSON.stringify(restored), JSON.stringify(font));
  assert.throws(() => templates.createFont("愛", [], store.read()), /追加済み/);
  assert.throws(() => templates.createFont("原", [{ character: "原" }], []), /追加済み/);
  store.remove("愛");
  assert.equal(store.read().length, 0);
});

test("非対応字形・不可視文字・不正な種類やフォントを保存しない", () => {
  const storage = memory(), store = templates.createStore(() => storage);
  for (const character of ["😀", "𰻞", "\u200b", "\u0301", "\u0000"]) {
    assert.throws(() => templates.createFont(character, [], []), /Klee One/);
    assert.equal(templates.validTemplates([{ character, kind: "font", fontFamily: "Klee One", updatedAt: item("原").updatedAt }]), false);
  }
  const font = templates.createFont("愛", [], []);
  for (const bad of [{ ...font, fontFamily: "other" }, { ...font, image: png }, { ...font, kind: "unknown" }, { ...font, character: "原夢" }]) {
    assert.throws(() => store.save(bad));
  }
  // 画像登録ならフォント未収録の文字も使える。
  store.save(item("𰻞"));
  assert.equal(store.read()[0].character, "𰻞");
});
