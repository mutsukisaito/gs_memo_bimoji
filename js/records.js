"use strict";

const PracticeRecords = (() => {
  const KEY = "bimoji.records.v1";
  const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
  const stamps = new Set(["sozai/grade1_taihenyoku.png", "sozai/grade3_ganbarimashita.png", "sozai/grade4_mousukoshi.png"]);
  const scoreValid = value => Number.isInteger(value) && value >= 0 && value <= 100;
  const textValid = value => typeof value === "string" && value.length > 0;
  function dateValid(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validRecord(record) {
    return record && textValid(record.id) && textValid(record.character) && Array.from(record.character).length === 1
      && textValid(record.createdAt) && Number.isFinite(Date.parse(record.createdAt))
      && dateValid(record.localDate)
      && Array.isArray(record.strokes) && record.strokes.length > 0
      && record.strokes.every(stroke => Array.isArray(stroke) && stroke.length > 0 && stroke.every(point => point
        && Number.isFinite(point.x) && point.x >= 0 && point.x <= 1
        && Number.isFinite(point.y) && point.y >= 0 && point.y <= 1))
      && record.evaluation && textValid(record.evaluation.version) && scoreValid(record.evaluation.score)
      && record.evaluation.scores && ["position", "size", "balance"].every(key => scoreValid(record.evaluation.scores[key]))
      && textValid(record.evaluation.focus) && textValid(record.evaluation.comment)
      && record.evaluation.stamp && stamps.has(record.evaluation.stamp.image) && textValid(record.evaluation.stamp.label)
      && record.reference && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(record.reference.image)
      && ["font", "image"].includes(record.reference.kind) && textValid(record.reference.version);
  }

  function validRecords(records) {
    return Array.isArray(records) && records.every(validRecord)
      && new Set(records.map(record => record.id)).size === records.length;
  }

  function parseBackup(text) {
    if (typeof text !== "string" || text.length > MAX_BACKUP_BYTES) throw new Error("読み込めるファイルは10MBまでのJSONファイルです。保存データは変更していません。");
    try {
      const backup = JSON.parse(text.replace(/^\uFEFF/, ""));
      if (backup.format !== "bimoji-log-backup" || backup.version !== 1
        || !textValid(backup.exportedAt) || !Number.isFinite(Date.parse(backup.exportedAt))
        || !validRecords(backup.records)) throw new Error();
      return backup.records;
    } catch {
      throw new Error("美文字ログのバックアップとして読み込めません。形式・バージョン・記録の内容を確認してください。保存データは変更していません。");
    }
  }

  // キーの順番だけが異なるJSONを、内容の相違と数えない。
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  function mergePlan(existing, incoming) {
    const byId = new Map(existing.map(record => [record.id, record]));
    const additions = [];
    let duplicates = 0;
    let conflicts = 0;
    for (const record of incoming) {
      const saved = byId.get(record.id);
      if (!saved) additions.push(record);
      else if (canonical(saved) === canonical(record)) duplicates++;
      else conflicts++;
    }
    return { additions, duplicates, conflicts, total: incoming.length };
  }

  // 毎回最新の内容を読み、読めない既存データは上書きしない。
  function createStore(getStorage) {
    function read() {
      let raw;
      try {
        raw = getStorage().getItem(KEY);
      } catch {
        throw new Error("このブラウザでは記録を読み込めません。ストレージの利用設定を確認してください。");
      }
      if (raw === null) return [];
      try {
        const saved = JSON.parse(raw);
        if (saved.version !== 1 || !validRecords(saved.records)) throw new Error();
        return saved.records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      } catch {
        throw new Error("保存データを読み込めません。既存データを保護するため保存・削除を停止しています。ブラウザのデータを消さずにご確認ください。");
      }
    }

    function write(records) {
      try {
        getStorage().setItem(KEY, JSON.stringify({ version: 1, records }));
      } catch (error) {
        if (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED") {
          throw new Error("保存容量がいっぱいです。不要な記録を削除してから、もう一度お試しください。既存データは変更していません。");
        }
        throw new Error("記録の変更を保存できませんでした。ストレージの利用設定を確認して、もう一度お試しください。");
      }
    }

    return {
      read,
      exportBackup() {
        return JSON.stringify({ format: "bimoji-log-backup", version: 1, exportedAt: new Date().toISOString(), records: read() }, null, 2);
      },
      previewImport(text) {
        return mergePlan(read(), parseBackup(text));
      },
      importBackup(text) {
        // 確認画面を開いた後の追加・削除も反映し、一括で保存する。
        const existing = read();
        const plan = mergePlan(existing, parseBackup(text));
        if (plan.additions.length) write([...plan.additions, ...existing]);
        return { added: plan.additions.length, duplicates: plan.duplicates, conflicts: plan.conflicts };
      },
      save(record) {
        if (!validRecord(record)) throw new Error("記録の形式が正しくないため保存できませんでした。");
        const records = read();
        if (records.some(saved => saved.id === record.id)) return;
        write([record, ...records]);
      },
      remove(id) {
        const records = read();
        const remaining = records.filter(record => record.id !== id);
        if (remaining.length !== records.length) write(remaining);
      },
    };
  }

  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  // 保存順に依存せず日時で選ぶ。同一日時の場合は新しい保存が先の配列順を保つ。
  function summarize(records) {
    const newestFirst = [...records].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const groups = new Map();
    for (const record of newestFirst) {
      if (!groups.has(record.character)) groups.set(record.character, []);
      groups.get(record.character).push(record);
    }
    return {
      practiceCount: records.length,
      practiceDays: new Set(records.map(record => record.localDate)).size,
      characters: [...groups].map(([character, history]) => ({
        character, count: history.length, first: history[history.length - 1], latest: history[0],
      })),
    };
  }

  function latestFor(records, character) {
    return summarize(records).characters.find(group => group.character === character)?.latest || null;
  }

  function sortRecords(records, order = "date-desc") {
    const newestFirst = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
    const comparators = {
      "date-desc": newestFirst,
      "date-asc": (a, b) => -newestFirst(a, b),
      "score-desc": (a, b) => b.evaluation.score - a.evaluation.score || newestFirst(a, b),
      "score-asc": (a, b) => a.evaluation.score - b.evaluation.score || newestFirst(a, b),
    };
    return [...records].sort(comparators[order] || newestFirst);
  }

  return { KEY, MAX_BACKUP_BYTES, createStore, localDate, summarize, latestFor, validRecords, canonical, sortRecords };
})();
