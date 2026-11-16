"use strict";

const AppBackup = (() => {
  const KEY = "bimoji.data.v1";
  function parse(text) {
    if (typeof text !== "string" || text.length > PracticeRecords.MAX_BACKUP_BYTES) throw new Error("読み込めるファイルは10MBまでです。保存データは変更していません。");
    try {
      const backup = JSON.parse(text.replace(/^\uFEFF/, ""));
      if (backup.format !== "bimoji-log-backup" || ![1, 2].includes(backup.version)
        || typeof backup.exportedAt !== "string" || !Number.isFinite(Date.parse(backup.exportedAt))
        || !PracticeRecords.validRecords(backup.records)) throw new Error();
      const templates = backup.version === 1 ? [] : backup.templates;
      if (!CustomTemplates.validTemplates(templates)) throw new Error();
      return { records: backup.records.map(PracticeRecords.normalizeRecord), templates };
    } catch {
      throw new Error("美文字ログのバックアップとして読み込めません。形式・バージョン・記録・お手本を確認してください。保存データは変更していません。");
    }
  }

  function planFor(existing, incoming, key, equal) {
    const saved = new Map(existing.map(item => [item[key], item]));
    const additions = [];
    let duplicates = 0;
    let conflicts = 0;
    for (const item of incoming) {
      if (!saved.has(item[key])) additions.push(item);
      else if (equal(saved.get(item[key]), item)) duplicates++;
      else conflicts++;
    }
    return { additions, duplicates, conflicts, total: incoming.length };
  }

  function create(getStorage) {
    // 2種類のデータを1キーへ保存し、容量不足時も片方だけ取り込まれないようにする。
    // 旧キーは初回の保存が成功するまで読み取り専用で扱う。
    function readState() {
      const storage = getStorage();
      const raw = storage.getItem(KEY);
      if (raw === null) return { version: 1, records: storage.getItem(PracticeRecords.KEY), templates: storage.getItem(CustomTemplates.KEY) };
      try {
        const state = JSON.parse(raw);
        if (state.version !== 1 || ![state.records, state.templates].every(value => value === null || typeof value === "string")) throw new Error();
        return state;
      } catch { throw new Error("保存データを読み込めません。既存データを保護するため変更を停止しています。"); }
    }
    function commit(state) {
      const storage = getStorage();
      storage.setItem(KEY, JSON.stringify(state));
      // 成功後にだけ旧データを片付ける。失敗しても新キーを正とし、データは失わない。
      for (const oldKey of [PracticeRecords.KEY, CustomTemplates.KEY]) {
        try { storage.removeItem?.(oldKey); } catch { /* 次回も新キーを優先する。 */ }
      }
    }
    const adapter = {
      getItem(key) {
        const state = readState();
        return key === PracticeRecords.KEY ? state.records : state.templates;
      },
      setItem(key, value) {
        const state = readState();
        state[key === PracticeRecords.KEY ? "records" : "templates"] = value;
        commit(state);
      },
    };
    const records = PracticeRecords.createStore(() => adapter);
    const templates = CustomTemplates.createStore(() => adapter);
    function previewImport(text) {
      const incoming = parse(text);
      return {
        records: planFor(records.read(), incoming.records, "id", (a, b) => PracticeRecords.canonical(a) === PracticeRecords.canonical(b)),
        templates: planFor(templates.read(), incoming.templates, "character", (a, b) => a.image === b.image),
      };
    }
    return {
      records, templates,
      exportBackup() {
        return JSON.stringify({ format: "bimoji-log-backup", version: 2, exportedAt: new Date().toISOString(), records: records.read(), templates: templates.read() }, null, 2);
      },
      previewImport,
      importBackup(text) {
        const plan = previewImport(text);
        if (plan.records.additions.length || plan.templates.additions.length) {
          const state = readState();
          if (plan.records.additions.length) state.records = JSON.stringify({ version: 1, records: [...plan.records.additions, ...records.read()] });
          if (plan.templates.additions.length) state.templates = JSON.stringify({ version: 1, templates: [...plan.templates.additions, ...templates.read()] });
          try { commit(state); }
          catch (error) {
            if (["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(error.name)) throw new Error("保存容量がいっぱいです。記録もお手本も追加していません。不要なデータを削除してから再度お試しください。");
            throw new Error("読み込み結果を保存できませんでした。記録もお手本も変更していません。ストレージの利用設定を確認してください。");
          }
        }
        const counts = part => ({ added: part.additions.length, duplicates: part.duplicates, conflicts: part.conflicts });
        return { records: counts(plan.records), templates: counts(plan.templates) };
      },
    };
  }
  return { KEY, create };
})();
