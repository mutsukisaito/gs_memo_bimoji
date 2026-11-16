"use strict";

// 保存処理や画面遷移を持たず、記録から表示要素だけを組み立てる。
const RecordViews = (() => {
  const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const formatDate = iso => dateFormatter.format(new Date(iso));

  function comparisonSide(record, label) {
    const side = document.createElement("div");
    side.className = "comparison-side";
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 400;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${record.character}の${label}の筆跡`);
    CanvasDrawing.paintStrokes(canvas, record.strokes);
    const date = document.createElement("time");
    date.dateTime = record.createdAt;
    date.textContent = formatDate(record.createdAt);
    const score = document.createElement("p");
    score.className = "comparison-score";
    score.textContent = `${record.evaluation.score}点`;
    const meta = document.createElement("div");
    meta.className = "comparison-meta";
    meta.append(score, date);
    side.append(canvas, meta);
    return side;
  }

  function createRecordCard(record, onOpen) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "record-card";
    button.setAttribute("aria-label", `${record.character}、${formatDate(record.createdAt)}、${record.evaluation.score}点の記録を開く`);
    const thumbnail = document.createElement("canvas");
    thumbnail.width = thumbnail.height = 240;
    thumbnail.setAttribute("aria-hidden", "true");
    CanvasDrawing.paintStrokes(thumbnail, record.strokes);
    const info = document.createElement("span");
    info.className = "record-card-info";
    const title = document.createElement("strong");
    title.textContent = `${record.character} · ${record.evaluation.score}点`;
    const date = document.createElement("time");
    date.dateTime = record.createdAt;
    date.textContent = formatDate(record.createdAt);
    info.append(title, date);
    button.append(thumbnail, info);
    button.addEventListener("click", () => onOpen(record.id));
    return button;
  }

  function createComparisonCard(group) {
    const card = document.createElement("section");
    card.className = "comparison-card";
    card.setAttribute("aria-label", `${group.character}の成長比較`);
    const pair = document.createElement("div");
    pair.className = "comparison-pair";
    pair.append(comparisonSide(group.first, "最初の自分"));
    pair.append(comparisonSide(group.best, "最高点の自分"));
    card.append(pair);
    if (group.first.reference.image !== group.best.reference.image
      || group.first.evaluation.version !== group.best.evaluation.version) {
      const note = document.createElement("p");
      note.className = "comparison-note";
      note.textContent = "お手本または採点方法が異なる記録です。点数は参考に、字の変化を見比べてください。";
      card.append(note);
    }
    return card;
  }

  return { formatDate, createRecordCard, createComparisonCard };
})();
