"use strict";

// 字形の正誤ではなく、枠内での配置を評価する。DOMと分離し計算を検証可能にする。
const HandwritingEvaluation = (() => {
  const VERSION = "layout-v1";
  const STAMPS = [
    { minimum: 85, label: "たいへんよくできました", image: "sozai/grade1_taihenyoku.png" },
    { minimum: 60, label: "がんばりました", image: "sozai/grade3_ganbarimashita.png" },
    { minimum: 0, label: "もうすこしがんばりましょう", image: "sozai/grade4_mousukoshi.png" },
  ];

  // 白背景画像と透過Canvasを同じ基準で扱う。ガイド線はCanvas外のCSSで描画する。
  function inspectInk(imageData) {
    const { width, height, data } = imageData;
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    let pixels = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const luminance = (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255;
        const darkness = data[offset + 3] / 255 * (1 - luminance);
        if (darkness < 0.18) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        pixels++;
      }
    }
    if (!pixels) return null;
    return {
      x: (left + right + 1) / (2 * width),
      y: (top + bottom + 1) / (2 * height),
      width: (right - left + 1) / width,
      height: (bottom - top + 1) / height,
    };
  }

  const toScore = error => Math.round(100 * (1 - Math.min(1, Math.max(0, error))));

  function evaluate(reference, writing) {
    if (!reference) throw new Error("お手本の文字を読み取れません。別のお手本を選んでください。");
    if (!writing) throw new Error("白い枠に一文字書いてから採点してください。");
    if (Math.max(writing.width, writing.height) < 0.03) {
      throw new Error("点だけでは配置を比べられません。一文字書いてから採点してください。");
    }

    const dx = writing.x - reference.x;
    const dy = writing.y - reference.y;
    // 面積の平方根で全体の大きさ、縦横比で形の偏りを別々に測る。
    const sizeRatio = Math.sqrt(writing.width * writing.height / (reference.width * reference.height));
    const aspectRatio = (writing.width / writing.height) / (reference.width / reference.height);
    const sizeDifference = Math.log2(sizeRatio);
    const aspectDifference = Math.log2(aspectRatio);
    const errors = {
      position: Math.hypot(dx, dy) / 0.35,
      size: Math.abs(sizeDifference),
      balance: Math.abs(aspectDifference),
    };
    const scores = Object.fromEntries(Object.entries(errors).map(([key, error]) => [key, toScore(error)]));
    const score = Math.round(scores.position * 0.35 + scores.size * 0.35 + scores.balance * 0.30);
    const weakest = Object.keys(errors).reduce((a, b) => errors[a] >= errors[b] ? a : b);
    let comment;
    let focus;
    if (errors[weakest] <= 0.12) {
      focus = "良かったところ";
      comment = "位置・大きさ・縦横のバランスがお手本に近いです。この配置を意識して、もう一度書いてみましょう。";
    } else if (weakest === "position") {
      focus = "次は、位置を意識";
      const direction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "右" : "左") : (dy > 0 ? "下" : "上");
      const correction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "左" : "右") : (dy > 0 ? "上" : "下");
      comment = `お手本より${direction}に寄っています。文字全体を少し${correction}に置くように書いてみましょう。`;
    } else if (weakest === "size") {
      focus = "次は、大きさを意識";
      comment = sizeDifference > 0
        ? "お手本より大きめです。周りに余白を残して、少し小さく書いてみましょう。"
        : "お手本より小さめです。枠を使って、もう少し大きく書いてみましょう。";
    } else {
      focus = "次は、縦横のバランスを意識";
      comment = aspectDifference > 0
        ? "お手本より横長です。横幅を少し抑えることを意識してみましょう。"
        : "お手本より縦長です。高さを少し抑えることを意識してみましょう。";
    }
    return { version: VERSION, score, scores, focus, comment, stamp: STAMPS.find(stamp => score >= stamp.minimum) };
  }

  return { inspectInk, evaluate };
})();
