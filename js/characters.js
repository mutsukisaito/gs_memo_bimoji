// 画像のお手本は CHARACTERS の各項目に image: "img/ファイル名.png" を指定する。
// 画像が未指定、または読み込めない場合はフォントのお手本を使う。
const CHARACTERS = [
  ...Array.from("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん", character => ({ character, category: "hiragana" })),
  ...Array.from("原夢福岡庵無見同紅花彩投資目標子川辺春夏秋冬健康豊作夕内暮口田古由身家屋金和透", character => ({ character, category: "kanji" })),
];
