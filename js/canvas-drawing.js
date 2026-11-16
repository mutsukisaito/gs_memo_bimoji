"use strict";

// 入力座標・筆跡再描画・お手本の重ね合わせを一か所で管理する。
const CanvasDrawing = (() => {
  // 座標は0〜1で保持。表示サイズが変わっても筆跡の比率を保つ。
  function pointFromEvent(canvas, event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  function drawSegment(canvas, from, to) {
    const writingContext = canvas.getContext("2d");
    const size = canvas.width;
    writingContext.strokeStyle = "#20231f";
    writingContext.fillStyle = "#20231f";
    writingContext.lineWidth = size * 0.013;
    writingContext.lineCap = "round";
    writingContext.lineJoin = "round";
    if (!from) {
      writingContext.beginPath();
      writingContext.arc(to.x * size, to.y * size, size * 0.0065, 0, Math.PI * 2);
      writingContext.fill();
      return;
    }
    writingContext.beginPath();
    writingContext.moveTo(from.x * size, from.y * size);
    writingContext.lineTo(to.x * size, to.y * size);
    writingContext.stroke();
  }

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

  return { pointFromEvent, drawSegment, paintStrokes, paintReferenceOverlay };
})();
