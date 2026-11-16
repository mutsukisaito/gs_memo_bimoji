"use strict";

const writingCanvas = document.querySelector("#writing-canvas");
const writingContext = writingCanvas.getContext("2d");
const referenceCanvas = document.querySelector("#reference-canvas");
const referenceContext = referenceCanvas.getContext("2d");
const dialog = document.querySelector("#character-dialog");
const clearButton = document.querySelector("#clear");
const evaluateButton = document.querySelector("#evaluate");
const resultPanel = document.querySelector("#evaluation-result");
const overlayCanvas = document.querySelector("#overlay-canvas");
const overlayToggle = document.querySelector("#show-overlay");
const stampImage = document.querySelector("#result-stamp");
const status = document.querySelector("#writing-status");
const grid = document.querySelector("#character-grid");
const fontFamily = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif';
const backupService = AppBackup.create(() => window.localStorage);
const recordStore = backupService.records;
const templateStore = backupService.templates;
const saveButton = document.querySelector("#save-record");
const saveStatus = document.querySelector("#save-status");
const recordsList = document.querySelector("#records-list");
const recordsStatus = document.querySelector("#records-status");
const recordFilter = document.querySelector("#record-filter");
const recordSort = document.querySelector("#record-sort");
const recordDialog = document.querySelector("#record-dialog");
const recordOverlayToggle = document.querySelector("#record-show-overlay");
const recordOverlay = document.querySelector("#record-overlay");
let currentDraft = null;
let openRecordId = null;
let detailVersion = 0;
let referenceKind = "font";
let selected = CHARACTERS.find(item => item.character === "原");
let category = "kanji";
let strokes = [];
let activePointer = null;
let activeStroke = null;
let referenceVersion = 0;
let referenceReady = false;
let currentEvaluation = null;

function updateEvaluateButton() {
  evaluateButton.disabled = !referenceReady || !strokes.length || activePointer !== null || currentEvaluation !== null;
}

function resetEvaluation() {
  currentEvaluation = null;
  currentDraft = null;
  saveStatus.textContent = "";
  saveButton.disabled = false;
  saveButton.textContent = "この練習を保存する";
  resultPanel.hidden = true;
  overlayCanvas.hidden = true;
  stampImage.hidden = true;
  overlayToggle.checked = true;
  writingCanvas.classList.remove("evaluated");
  writingCanvas.setAttribute("aria-label", "手書き練習欄。指、ペン、マウスで書けます。");
  evaluateButton.textContent = "採点する";
  updateEvaluateButton();
}

function drawFontReference() {
  referenceKind = "font";
  // width再設定は、読み取り不可の外部画像が指定された際のCanvas状態も初期化する。
  referenceCanvas.width = 600;
  referenceContext.fillStyle = "#20231f";
  referenceContext.font = `470px ${fontFamily}`;
  referenceContext.textAlign = "center";
  referenceContext.textBaseline = "alphabetic";
  const metrics = referenceContext.measureText(selected.character);
  referenceContext.fillText(selected.character, 300, 300 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
}

function finishReference() {
  referenceReady = true;
  updateEvaluateButton();
}

function drawReference() {
  const version = ++referenceVersion;
  referenceReady = false;
  resetEvaluation();
  drawFontReference();
  referenceCanvas.setAttribute("aria-label", `${selected.character}のお手本`);
  if (!selected.image) {
    finishReference();
    return;
  }
  const image = new Image();
  image.onload = () => {
    if (version !== referenceVersion) return;
    referenceContext.clearRect(0, 0, 600, 600);
    const scale = Math.min(600 / image.width, 600 / image.height);
    referenceContext.drawImage(image, (600 - image.width * scale) / 2, (600 - image.height * scale) / 2, image.width * scale, image.height * scale);
    referenceKind = "image";
    try {
      referenceContext.getImageData(0, 0, 1, 1);
    } catch {
      drawFontReference();
      status.textContent = "この画像は採点に使えないため、フォントで表示しています";
    }
    finishReference();
  };
  image.onerror = () => {
    if (version !== referenceVersion) return;
    status.textContent = "お手本画像を読み込めないため、フォントで表示しています";
    finishReference();
  };
  image.src = selected.image;
}

// 座標は0〜1で保持。表示サイズが変わっても筆跡の比率を保つ。
function pointFromEvent(event) {
  const bounds = writingCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

function drawSegment(from, to) {
  writingContext.strokeStyle = "#20231f";
  writingContext.fillStyle = "#20231f";
  writingContext.lineWidth = 13;
  writingContext.lineCap = "round";
  writingContext.lineJoin = "round";
  if (!from) {
    writingContext.beginPath();
    writingContext.arc(to.x * 1000, to.y * 1000, 6.5, 0, Math.PI * 2);
    writingContext.fill();
    return;
  }
  writingContext.beginPath();
  writingContext.moveTo(from.x * 1000, from.y * 1000);
  writingContext.lineTo(to.x * 1000, to.y * 1000);
  writingContext.stroke();
}

function finishStroke(event) {
  if (event.pointerId !== activePointer) return;
  if (writingCanvas.hasPointerCapture(activePointer)) writingCanvas.releasePointerCapture(activePointer);
  activePointer = null;
  activeStroke = null;
  updateEvaluateButton();
}

writingCanvas.addEventListener("pointerdown", event => {
  if (currentEvaluation || activePointer !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  writingCanvas.setPointerCapture(event.pointerId);
  activePointer = event.pointerId;
  activeStroke = [pointFromEvent(event)];
  strokes.push(activeStroke);
  drawSegment(null, activeStroke[0]);
  clearButton.disabled = false;
  updateEvaluateButton();
  status.textContent = "";
});

writingCanvas.addEventListener("pointermove", event => {
  if (event.pointerId !== activePointer || !activeStroke) return;
  event.preventDefault();
  const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
  for (const sample of events.length ? events : [event]) {
    const point = pointFromEvent(sample);
    drawSegment(activeStroke[activeStroke.length - 1], point);
    activeStroke.push(point);
  }
});
writingCanvas.addEventListener("pointerup", finishStroke);
writingCanvas.addEventListener("pointercancel", finishStroke);
writingCanvas.addEventListener("lostpointercapture", finishStroke);

function clearWriting() {
  if (activePointer !== null) finishStroke({ pointerId: activePointer });
  strokes = [];
  resetEvaluation();
  writingContext.clearRect(0, 0, 1000, 1000);
  clearButton.disabled = true;
  status.textContent = "";
}
clearButton.addEventListener("click", clearWriting);

function paintReferenceOverlay(referencePixels, targetCanvas) {
  // 白背景も透過背景も同じグレーの筆跡へ変換。描画位置・倍率は補正しない。
  const pixels = new Uint8ClampedArray(referencePixels.data);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const luminance = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
    pixels[offset + 3] = Math.round(pixels[offset + 3] * (1 - luminance) * 0.30);
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 70;
  }
  const mask = document.createElement("canvas");
  mask.width = referencePixels.width;
  mask.height = referencePixels.height;
  mask.getContext("2d").putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);
  const context = targetCanvas.getContext("2d");
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  context.drawImage(mask, 0, 0, targetCanvas.width, targetCanvas.height);
}

evaluateButton.addEventListener("click", () => {
  if (!referenceReady || activePointer !== null || currentEvaluation) return;
  try {
    const referencePixels = referenceContext.getImageData(0, 0, 600, 600);
    const writingPixels = writingContext.getImageData(0, 0, 1000, 1000);
    const evaluation = HandwritingEvaluation.evaluate(
      HandwritingEvaluation.inspectInk(referencePixels),
      HandwritingEvaluation.inspectInk(writingPixels),
    );
    const now = new Date();
    currentDraft = {
      id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      character: selected.character,
      createdAt: now.toISOString(),
      localDate: PracticeRecords.localDate(now),
      strokes: strokes.map(stroke => stroke.map(point => ({ x: Number(point.x.toFixed(5)), y: Number(point.y.toFixed(5)) }))),
      evaluation,
      // PNGを保存するので、後日フォントや画像が変わっても当時のお手本を再現できる。
      reference: { image: referenceCanvas.toDataURL("image/png"), kind: referenceKind, version: "reference-v1", fontFamily, source: referenceKind === "image" ? (selected.category === "custom" ? `custom:${selected.character}` : selected.image) : null },
    };
    paintReferenceOverlay(referencePixels, overlayCanvas);
    overlayCanvas.hidden = !overlayToggle.checked;
    currentEvaluation = evaluation;
    document.querySelector("#total-score").textContent = evaluation.score;
    document.querySelector("#feedback-focus").textContent = evaluation.focus;
    document.querySelector("#feedback-comment").textContent = evaluation.comment;
    for (const [key, score] of Object.entries(evaluation.scores)) {
      document.querySelector(`#${key}-score`).textContent = `${score}点`;
    }
    stampImage.src = evaluation.stamp.image;
    stampImage.alt = evaluation.stamp.label;
    stampImage.hidden = false;
    resultPanel.hidden = false;
    writingCanvas.classList.add("evaluated");
    writingCanvas.setAttribute("aria-label", `${selected.character}の採点済みの筆跡。書き直すボタンで再び入力できます。`);
    evaluateButton.textContent = "採点済み";
    updateEvaluateButton();
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
  }
});

overlayToggle.addEventListener("change", () => {
  overlayCanvas.hidden = !overlayToggle.checked || !currentEvaluation;
});

function renderCharacters() {
  grid.replaceChildren();
  const listStatus = document.querySelector("#template-list-status");
  listStatus.textContent = "";
  let custom = [];
  try {
    custom = templateStore.read().map(item => ({ ...item, category: "custom" }));
    document.querySelector("#template-count").textContent = custom.length;
    if (category === "custom" && !custom.length) listStatus.textContent = "登録したお手本はありません。画像のお手本を登録してみましょう。";
  } catch (error) {
    document.querySelector("#template-count").textContent = "—";
    listStatus.textContent = error.message;
  }
  document.querySelector("#remove-template-area").hidden = category !== "custom" || !custom.some(item => selected.category === "custom" && item.character === selected.character);
  document.querySelector("#remove-template-confirm").hidden = true;
  document.querySelector("#remove-template").hidden = false;
  for (const item of [...CHARACTERS, ...custom].filter(item => item.category === category)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.character;
    button.setAttribute("aria-label", `${item.character}を練習する`);
    const isSelected = item.character === selected.character && item.category === selected.category && item.image === selected.image;
    button.setAttribute("aria-pressed", String(isSelected));
    button.addEventListener("click", () => {
      if (!isSelected) {
        if (strokes.length && !window.confirm("書きかけの文字を消して、お手本を変更しますか？")) return;
        selected = item;
        clearWriting();
        drawReference();
      }
      dialog.close();
    });
    grid.append(button);
  }
  for (const button of document.querySelectorAll("[data-category]")) {
    button.setAttribute("aria-pressed", String(button.dataset.category === category));
  }
}

document.querySelector("#choose-character").addEventListener("click", () => {
  category = selected.category;
  renderCharacters();
  dialog.showModal();
});
document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
for (const button of document.querySelectorAll("[data-category]")) {
  button.addEventListener("click", () => {
    category = button.dataset.category;
    renderCharacters();
  });
}

// 保存済みの筆跡は座標から描き直す。一覧用の小さな画像を重複保存しない。
function paintStrokes(canvas, savedStrokes) {
  const context = canvas.getContext("2d");
  const size = canvas.width;
  context.clearRect(0, 0, size, size);
  context.strokeStyle = context.fillStyle = "#20231f";
  context.lineWidth = size * 0.013;
  context.lineCap = context.lineJoin = "round";
  for (const stroke of savedStrokes) {
    context.beginPath();
    context.arc(stroke[0].x * size, stroke[0].y * size, size * 0.0065, 0, Math.PI * 2);
    context.fill();
    if (stroke.length < 2) continue;
    context.beginPath();
    context.moveTo(stroke[0].x * size, stroke[0].y * size);
    for (const point of stroke.slice(1)) context.lineTo(point.x * size, point.y * size);
    context.stroke();
  }
}

const formatDate = iso => new Intl.DateTimeFormat("ja-JP", {
  year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(iso));

function syncSaveButton(records) {
  if (!currentDraft) return;
  const saved = records.some(record => record.id === currentDraft.id);
  saveButton.disabled = saved;
  saveButton.textContent = saved ? "保存済み" : "この練習を保存する";
}

function renderRecords(message = "") {
  recordsList.replaceChildren();
  try {
    const records = recordStore.read();
    syncSaveButton(records);
    const filterValue = recordFilter.value;
    recordFilter.replaceChildren(new Option("すべての文字", ""));
    const characters = [...new Set(records.map(record => record.character))];
    if (filterValue && !characters.includes(filterValue)) characters.push(filterValue);
    for (const character of characters) recordFilter.add(new Option(character, character));
    recordFilter.value = filterValue;
    const filtered = PracticeRecords.sortRecords(records.filter(record => !filterValue || record.character === filterValue), recordSort.value);
    document.querySelector("#records-count").textContent = filterValue ? `${filtered.length}件 / 全${records.length}件` : `${records.length}件`;
    recordsStatus.textContent = message || (records.length === 0
      ? "まだ記録がありません。「書く」で練習し、採点後に保存してみましょう。"
      : filtered.length === 0 ? "この文字の記録はありません。ほかの文字を選んでください。" : "");
    for (const record of filtered) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "record-card";
      button.setAttribute("aria-label", `${record.character}、${formatDate(record.createdAt)}、${record.evaluation.score}点の記録を開く`);
      const thumbnail = document.createElement("canvas");
      thumbnail.width = thumbnail.height = 240;
      thumbnail.setAttribute("aria-hidden", "true");
      paintStrokes(thumbnail, record.strokes);
      const info = document.createElement("span");
      info.className = "record-card-info";
      const title = document.createElement("strong");
      title.textContent = `${record.character} · ${record.evaluation.score}点`;
      const date = document.createElement("time");
      date.dateTime = record.createdAt;
      date.textContent = formatDate(record.createdAt);
      info.append(title, date);
      button.append(thumbnail, info);
      button.addEventListener("click", () => openRecord(record.id));
      recordsList.append(button);
    }
    return records;
  } catch (error) {
    recordsStatus.textContent = error.message;
    document.querySelector("#records-count").textContent = "読み込み不可";
    return null;
  }
}

saveButton.addEventListener("click", () => {
  if (!currentDraft) return;
  try {
    recordStore.save(currentDraft);
    saveButton.disabled = true;
    saveButton.textContent = "保存済み";
    saveStatus.textContent = "保存しました。「記録」タブから見返せます。";
    renderGrowth();
  } catch (error) {
    saveStatus.textContent = error.message;
  }
});

for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => {
    if (activePointer !== null) finishStroke({ pointerId: activePointer });
    for (const tabButton of document.querySelectorAll("[data-view]")) {
      const active = tabButton === button;
      tabButton.classList.toggle("active", active);
      if (active) tabButton.setAttribute("aria-current", "page");
      else tabButton.removeAttribute("aria-current");
      document.querySelector(`#${tabButton.dataset.view}-view`).hidden = !active;
    }
    if (button.dataset.view === "records") renderRecords();
    if (button.dataset.view === "growth") renderGrowth();
  });
}
recordFilter.addEventListener("change", () => renderRecords());
recordSort.addEventListener("change", () => renderRecords());

function openRecord(id) {
  try {
    const record = recordStore.read().find(item => item.id === id);
    if (!record) {
      renderRecords("この記録はすでに削除されています。");
      return;
    }
    const version = ++detailVersion;
    openRecordId = id;
    document.querySelector("#record-title").textContent = `${record.character}の記録`;
    document.querySelector("#record-date").textContent = formatDate(record.createdAt);
    document.querySelector("#record-score").textContent = record.evaluation.score;
    document.querySelector("#record-focus").textContent = record.evaluation.focus;
    document.querySelector("#record-comment").textContent = record.evaluation.comment;
    document.querySelector("#delete-status").textContent = "";
    document.querySelector("#delete-confirmation").hidden = true;
    document.querySelector("#delete-record").hidden = false;
    for (const [key, score] of Object.entries(record.evaluation.scores)) {
      if (["position", "size", "balance"].includes(key)) document.querySelector(`#record-${key}`).textContent = `${score}点`;
    }
    const canvas = document.querySelector("#record-writing");
    canvas.setAttribute("aria-label", `${record.character}の保存した筆跡`);
    paintStrokes(canvas, record.strokes);
    const stamp = document.querySelector("#record-stamp");
    stamp.src = record.evaluation.stamp.image;
    stamp.alt = record.evaluation.stamp.label;
    stamp.hidden = false;
    recordOverlayToggle.checked = true;
    recordOverlay.hidden = false;
    recordOverlay.getContext("2d").clearRect(0, 0, 1000, 1000);
    const imageStatus = document.querySelector("#record-image-status");
    imageStatus.textContent = "お手本を読み込んでいます…";
    const image = new Image();
    image.onload = () => {
      if (version !== detailVersion) return;
      const snapshot = document.createElement("canvas");
      snapshot.width = snapshot.height = 600;
      const context = snapshot.getContext("2d");
      context.drawImage(image, 0, 0, 600, 600);
      paintReferenceOverlay(context.getImageData(0, 0, 600, 600), recordOverlay);
      imageStatus.textContent = "";
    };
    image.onerror = () => {
      if (version === detailVersion) imageStatus.textContent = "お手本画像を表示できませんでした。筆跡と評価は確認できます。";
    };
    image.src = record.reference.image;
    recordDialog.showModal();
  } catch (error) {
    recordsStatus.textContent = error.message;
  }
}

document.querySelector("#close-record").addEventListener("click", () => recordDialog.close());
recordDialog.addEventListener("close", () => {
  openRecordId = null;
  detailVersion++;
  document.querySelector("[data-view=records]").focus();
});
recordOverlayToggle.addEventListener("change", () => {
  recordOverlay.hidden = !recordOverlayToggle.checked;
  document.querySelector("#record-stamp").hidden = !recordOverlayToggle.checked;
});
document.querySelector("#delete-record").addEventListener("click", () => {
  document.querySelector("#delete-confirmation").hidden = false;
  document.querySelector("#delete-record").hidden = true;
  document.querySelector("#cancel-delete").focus();
});
document.querySelector("#cancel-delete").addEventListener("click", () => {
  document.querySelector("#delete-confirmation").hidden = true;
  document.querySelector("#delete-record").hidden = false;
  document.querySelector("#delete-record").focus();
});
document.querySelector("#confirm-delete").addEventListener("click", () => {
  if (!openRecordId) return;
  try {
    recordStore.remove(openRecordId);
    recordDialog.close();
    renderRecords("記録を削除しました。");
    renderGrowth();
  } catch (error) {
    document.querySelector("#delete-status").textContent = error.message;
  }
});

window.addEventListener("storage", event => {
  if (![PracticeRecords.KEY, AppBackup.KEY, null].includes(event.key)) return;
  const records = renderRecords();
  renderGrowth();
  if (recordDialog.open && records && !records.some(record => record.id === openRecordId)) {
    recordDialog.close();
    recordsStatus.textContent = "別のタブでこの記録が削除されました。";
  }
});

function comparisonSide(record, label) {
  const side = document.createElement("div");
  side.className = "comparison-side";
  const heading = document.createElement("p");
  heading.className = "comparison-label";
  heading.textContent = label;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 400;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${record.character}の${label}の筆跡`);
  paintStrokes(canvas, record.strokes);
  const date = document.createElement("time");
  date.dateTime = record.createdAt;
  date.textContent = formatDate(record.createdAt);
  const score = document.createElement("p");
  score.className = "comparison-score";
  score.textContent = `${record.evaluation.score}点`;
  side.append(heading, canvas, date, score);
  return side;
}

function renderGrowth() {
  const list = document.querySelector("#growth-list");
  const growthStatus = document.querySelector("#growth-status");
  list.replaceChildren();
  try {
    const summary = PracticeRecords.summarize(recordStore.read());
    document.querySelector("#practice-count").textContent = summary.practiceCount;
    document.querySelector("#practice-days").textContent = summary.practiceDays;
    growthStatus.textContent = summary.practiceCount ? "" : "まだ記録がありません。練習を保存すると、ここで振り返れます。";
    for (const group of summary.characters) {
      const card = document.createElement("section");
      card.className = "comparison-card";
      const title = document.createElement("h3");
      title.textContent = `${group.character}の歩み`;
      const count = document.createElement("p");
      count.className = "comparison-count";
      count.textContent = `${group.count}回の練習`;
      const pair = document.createElement("div");
      pair.className = "comparison-pair";
      pair.append(comparisonSide(group.first, "最初の自分"));
      if (group.count > 1) {
        pair.append(comparisonSide(group.latest, "最新の自分"));
      } else {
        const placeholder = document.createElement("p");
        placeholder.className = "comparison-placeholder";
        placeholder.textContent = "もう一度この文字を保存すると、ここに最新の記録が並びます。";
        pair.append(placeholder);
      }
      card.append(title, count, pair);
      if (group.count > 1 && (group.first.reference.image !== group.latest.reference.image
        || group.first.evaluation.version !== group.latest.evaluation.version)) {
        const note = document.createElement("p");
        note.className = "comparison-note";
        note.textContent = "お手本または採点方法が異なる記録です。点数は参考に、字の変化を見比べてください。";
        card.append(note);
      }
      list.append(card);
    }
  } catch (error) {
    document.querySelector("#practice-count").textContent = "—";
    document.querySelector("#practice-days").textContent = "—";
    growthStatus.textContent = error.message;
  }
}

const backupStatus = document.querySelector("#backup-status");
const importInput = document.querySelector("#import-records");
const importDialog = document.querySelector("#import-dialog");
const importStatus = document.querySelector("#import-status");
const confirmImport = document.querySelector("#confirm-import");
let pendingImport = null;
let importReadVersion = 0;

document.querySelector("#export-records").addEventListener("click", () => {
  let url;
  try {
    const json = backupService.exportBackup();
    const now = new Date();
    const filename = `bimoji-backup-${PracticeRecords.localDate(now)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}.json`;
    url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    backupStatus.textContent = `${filename}を書き出しました。端末のダウンロード先を確認してください。`;
  } catch (error) {
    backupStatus.textContent = error.message;
  } finally {
    // ダウンロードの開始前にURLを破棄しないよう、少し後で解放する。
    if (url) window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
});

function showImportSummary(plan) {
  const describe = (label, part) => `${label} ${part.total}件：追加 ${part.additions.length}件、重複 ${part.duplicates}件、内容違い ${part.conflicts}件。`;
  document.querySelector("#import-summary").textContent = `${describe("記録", plan.records)}\n${describe("登録お手本", plan.templates)}`;
  const count = plan.records.additions.length + plan.templates.additions.length;
  confirmImport.disabled = count === 0;
  confirmImport.textContent = count ? `合計${count}件を追加する` : "追加するデータはありません";
}

importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  // キャンセル後や失敗後に同じファイルを再選択できるようにする。
  importInput.value = "";
  if (!file) return;
  const version = ++importReadVersion;
  pendingImport = null;
  try {
    if (file.size > PracticeRecords.MAX_BACKUP_BYTES) throw new Error("読み込めるファイルは10MBまでです。保存データは変更していません。");
    backupStatus.textContent = "ファイルを確認しています…";
    const text = await file.text();
    if (version !== importReadVersion) return;
    const plan = backupService.previewImport(text);
    pendingImport = { text };
    document.querySelector("#import-filename").textContent = file.name;
    importStatus.textContent = "";
    showImportSummary(plan);
    backupStatus.textContent = "内容を確認してから追加してください。";
    importDialog.showModal();
  } catch (error) {
    if (version === importReadVersion) backupStatus.textContent = error.message;
  }
});

function cancelImport() {
  backupStatus.textContent = "読み込みをキャンセルしました。保存データは変更していません。";
  importDialog.close();
}
document.querySelector("#cancel-import").addEventListener("click", cancelImport);
document.querySelector("#close-import").addEventListener("click", cancelImport);
importDialog.addEventListener("cancel", () => {
  backupStatus.textContent = "読み込みをキャンセルしました。保存データは変更していません。";
});
importDialog.addEventListener("close", () => {
  pendingImport = null;
  importInput.focus();
});
confirmImport.addEventListener("click", () => {
  if (!pendingImport) return;
  try {
    const result = backupService.importBackup(pendingImport.text);
    importDialog.close();
    recordFilter.value = "";
    renderRecords();
    renderGrowth();
    backupStatus.textContent = `記録 ${result.records.added}件・登録お手本 ${result.templates.added}件を追加しました。重複 ${result.records.duplicates + result.templates.duplicates}件、内容違い ${result.records.conflicts + result.templates.conflicts}件は読み飛ばしました。`;
  } catch (error) {
    importStatus.textContent = error.message;
  }
});

const templateDialog = document.querySelector("#template-dialog");
const templateFile = document.querySelector("#template-file");
const templateStatus = document.querySelector("#template-status");
const templatePreview = document.querySelector("#template-preview");
const templateSave = document.querySelector("#save-template");
let pendingTemplateImage = null;
let templateImageVersion = 0;

document.querySelector("#add-template").addEventListener("click", () => {
  dialog.close();
  document.querySelector("#template-form").reset();
  pendingTemplateImage = null;
  templateImageVersion++;
  templateSave.disabled = true;
  templateStatus.textContent = "";
  document.querySelector("#template-preview-area").hidden = true;
  templateDialog.showModal();
});
document.querySelector("#close-template").addEventListener("click", () => templateDialog.close());
templateDialog.addEventListener("close", () => {
  templateImageVersion++;
  pendingTemplateImage = null;
  document.querySelector("#choose-character").focus();
});

templateFile.addEventListener("click", () => { templateFile.value = ""; });
templateFile.addEventListener("change", async () => {
  const file = templateFile.files[0];
  const version = ++templateImageVersion;
  pendingTemplateImage = null;
  templateSave.disabled = true;
  document.querySelector("#template-preview-area").hidden = true;
  if (!file) return;
  let url;
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("PNG・JPEG・WebPの画像を選んでください。");
    if (file.size > CustomTemplates.MAX_FILE_BYTES) throw new Error("画像は10MBまでです。小さい画像を選んでください。");
    templateStatus.textContent = "画像を読み込んでいます…";
    url = URL.createObjectURL(file);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("画像を読み込めませんでした。別の画像を選んでください。"));
      image.src = url;
    });
    if (version !== templateImageVersion) return;
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) throw new Error("画像が大きすぎます。4000万画素以下の画像を選んでください。");
    const context = templatePreview.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 600, 600);
    const scale = Math.min(600 / image.naturalWidth, 600 / image.naturalHeight);
    context.drawImage(image, (600 - image.naturalWidth * scale) / 2, (600 - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
    const bounds = HandwritingEvaluation.inspectInk(context.getImageData(0, 0, 600, 600));
    if (!bounds || Math.max(bounds.width, bounds.height) < 0.03) throw new Error("文字を読み取れません。白背景または透過背景に黒い文字がある画像を選んでください。");
    const png = templatePreview.toDataURL("image/png");
    if (png.length > CustomTemplates.MAX_IMAGE_LENGTH) throw new Error("縮小後も画像の容量が大きいため登録できません。余分な背景を除いた文字の画像を選んでください。");
    pendingTemplateImage = png;
    templateSave.disabled = false;
    document.querySelector("#template-preview-area").hidden = false;
    templateStatus.textContent = `「${file.name}」のプレビューの文字と余白を確認して登録してください。`;
  } catch (error) {
    if (version === templateImageVersion) templateStatus.textContent = error.message;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
});

document.querySelector("#template-form").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const character = CustomTemplates.normalizeCharacter(document.querySelector("#template-character").value);
    if (!pendingTemplateImage) throw new Error("お手本画像を選んでください。");
    if (strokes.length && !document.querySelector("#discard-template-writing").checked) throw new Error("書きかけの文字があります。消して練習する場合は確認にチェックしてください。");
    const item = { character, image: pendingTemplateImage, updatedAt: new Date().toISOString() };
    templateStore.save(item, document.querySelector("#replace-template").checked);
    selected = { ...item, category: "custom" };
    category = "custom";
    clearWriting();
    drawReference();
    templateDialog.close();
    status.textContent = `「${character}」のお手本を登録しました。画像を見ながら練習してみましょう。`;
  } catch (error) {
    templateStatus.textContent = error.message;
  }
});

document.querySelector("#remove-template").addEventListener("click", () => {
  document.querySelector("#remove-template-confirm").hidden = false;
  document.querySelector("#remove-template").hidden = true;
  document.querySelector("#cancel-remove-template").focus();
});
document.querySelector("#cancel-remove-template").addEventListener("click", renderCharacters);
document.querySelector("#confirm-remove-template").addEventListener("click", () => {
  if (selected.category !== "custom") return;
  try {
    templateStore.remove(selected.character);
    selected = CHARACTERS.find(item => item.character === selected.character) || CHARACTERS[0];
    clearWriting();
    drawReference();
    renderCharacters();
    document.querySelector("#template-list-status").textContent = "お手本を削除しました。保存済みの練習記録は残っています。";
  } catch (error) {
    document.querySelector("#template-list-status").textContent = error.message;
  }
});

window.addEventListener("storage", event => {
  if ([CustomTemplates.KEY, AppBackup.KEY, null].includes(event.key)) {
    if (dialog.open) renderCharacters();
  }
});

drawReference();
if (document.fonts) document.fonts.ready.then(drawReference);
