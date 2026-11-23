# Klee One Regular

美文字ログの標準お手本として使用するフォントです。フォント本体は公式配布ファイルを変更せずに同梱しています。

- 配布元：[fontworks-fonts/Klee](https://github.com/fontworks-fonts/Klee)
- 取得元：[KleeOne-Regular.ttf](https://github.com/fontworks-fonts/Klee/blob/master/fonts/ttf/KleeOne-Regular.ttf)
- 取得日：2026年11月16日
- 著作権：Copyright 2020 The Klee Project Authors
- ライセンス：SIL Open Font License 1.1（[OFL.txt](OFL.txt)）

現時点の標準文字85文字（ひらがな46・漢字39）の収録を確認しています。フォントを再配布する場合は、著作権表示とOFL.txtを一緒に保持してください。

文字名だけの追加では、同梱ファイルのcmapから生成した `js/font-characters.js` で字形の有無を確認します。フォントを差し替えた場合は `node scripts/generate-font-coverage.cjs` で対応範囲を再生成してください。フォント本体は変更しません。
