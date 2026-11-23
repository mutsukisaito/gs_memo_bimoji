"use strict";

const CustomTemplates = (() => {
  const KEY = "bimoji.templates.v1";
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_IMAGE_LENGTH = 1500000;
  function normalizeCharacter(value) {
    const character = typeof value === "string" ? value.trim().normalize("NFC") : "";
    if (Array.from(character).length !== 1 || /\s/.test(character)) throw new Error("文字名は練習したい1文字を入力してください。");
    return character;
  }
  function valid(item) {
    try {
      if (!item || normalizeCharacter(item.character) !== item.character
        || typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))) return false;
      if (item.kind === "font") return item.fontFamily === "Klee One" && item.image === undefined && FontCharacters.supports(item.character);
      // 種類のない旧データは、これまでどおり画像のお手本として読む。
      return (item.kind === undefined || item.kind === "image")
        && typeof item.image === "string" && item.image.length <= MAX_IMAGE_LENGTH
        && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+=*$/.test(item.image);
    } catch { return false; }
  }
  function createFont(value, standardCharacters, registered) {
    const character = normalizeCharacter(value);
    if (standardCharacters.some(item => item.character === character) || registered.some(item => item.character === character)) {
      throw new Error("この文字は追加済みです。文字一覧から選んで練習してください。");
    }
    if (!FontCharacters.supports(character)) throw new Error("Klee Oneにない文字です。画像のお手本を登録してください。");
    return { character, kind: "font", fontFamily: "Klee One", updatedAt: new Date().toISOString() };
  }
  function sameReference(a, b) {
    return a.kind === "font" || b.kind === "font"
      ? a.kind === b.kind && a.fontFamily === b.fontFamily : a.image === b.image;
  }
  function createStore(getStorage) {
    function read() {
      let raw;
      try { raw = getStorage().getItem(KEY); }
      catch { throw new Error("登録したお手本を読み込めません。ストレージの利用設定を確認してください。"); }
      if (raw === null) return [];
      try {
        const saved = JSON.parse(raw);
        if (saved.version !== 1 || !Array.isArray(saved.templates) || !saved.templates.every(valid)
          || new Set(saved.templates.map(item => item.character)).size !== saved.templates.length) throw new Error();
        return saved.templates;
      } catch { throw new Error("登録したお手本のデータを読み込めません。既存データを保護するため変更を停止しています。"); }
    }
    function write(templates) {
      try { getStorage().setItem(KEY, JSON.stringify({ version: 1, templates })); }
      catch (error) {
        if (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED") throw new Error("保存容量がいっぱいです。不要な記録やお手本を削除して、もう一度登録してください。既存データは変更していません。");
        throw new Error("お手本を保存できませんでした。既存データは変更していません。ストレージの利用設定を確認してください。");
      }
    }
    return {
      read,
      save(item, replace = false) {
        if (!valid(item)) throw new Error("お手本の形式が正しくありません。文字名と画像を確認してください。");
        const templates = read();
        if (!replace && templates.some(saved => saved.character === item.character)) throw new Error("この文字のお手本は登録済みです。画像を置き換える場合は確認にチェックしてください。");
        write([item, ...templates.filter(saved => saved.character !== item.character)]);
      },
      remove(character) {
        const templates = read();
        const next = templates.filter(item => item.character !== character);
        if (next.length !== templates.length) write(next);
      },
    };
  }
  function validTemplates(items) {
    return Array.isArray(items) && items.every(valid) && new Set(items.map(item => item.character)).size === items.length;
  }
  return { KEY, MAX_FILE_BYTES, MAX_IMAGE_LENGTH, normalizeCharacter, createFont, sameReference, createStore, validTemplates };
})();
