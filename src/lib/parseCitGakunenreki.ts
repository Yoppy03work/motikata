// 千葉工業大学 学生資料室の「学年暦」PDF を取得して AcademicEvent に流せる
// 形に正規化する。
//
// PDF 構造の前提:
//   - ヘッダに「２０XX年度」(全角数字) または「20XX年度」
//   - 各ページに月ごとのカレンダー + 「全学共通」テキスト枠
//   - 月の並びはページ1: 4,5,6,7,8 / ページ2: 9,10,11,12,1,2,3
//   - パース対象は右側のテキスト("X日：タイトル" など)
//   - 4〜12月 → 暦年 = 学年度、1〜3月 → 暦年 = 学年度 + 1
//
// パース可能パターン:
//   - "X日：title"
//   - "X・Y日：title" / "X・Y・Z日：title"
//   - "X～Y日：title" (範囲展開)
//   - "履修登録期間：X月Y日（曜） ～ X月Z日（曜）" (期間ヘッダ、グリッド外)
//   - "①日：title" / "②日：..." (CIRCLED_OVERRIDES に登録された年度のみ)
//     PDF はセル側に丸数字を図形描画しており pdfjs で取れないため、
//     注釈本文を見て具体日を当てる。新年度PDFは表現が変わっている可能性が
//     あるので、必ず import 後にプレビューで確認すること。
//
// 非対応:
//   - 色分けセル(視覚情報)

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PDF_URL = "https://kmsk.is.it-chiba.ac.jp/portal/whole/gakubu/gakunenreki.pdf";

// ページごとの月並び。CIT の PDF は前期/後期で固定レイアウト。
const PAGE_MONTHS: number[][] = [
  [4, 5, 6, 7, 8],
  [9, 10, 11, 12, 1, 2, 3],
];

export type CitParsedEvent = {
  title: string;
  date: Date;
  kind: "EXAM" | "HOLIDAY" | "EVENT";
};

const EXAM_KW = ["試験", "テスト", "考査", "中間", "期末", "共通テスト"];
// 「休講」「休業」を含むものだけ HOLIDAY。
// 「祝日授業日」は名前に「祝日」を含むが意味は授業日(=EVENT)なので
// 単純に「祝日」キーワードでマッチさせない。
const HOLIDAY_KW = ["休講", "休業"];

// 丸数字注釈の解釈テーブル(年度別)。
// PDFはセル側に①などのマークを描画するが、pdfjsのテキスト抽出では
// 取り出せないため、注釈本文と (academicYear, month) の組で具体日を割り当てる。
// 1注釈が複数日に渡る場合(振替休講+ブリッジで土曜も休にするなど)は days を配列で。
// 新年度PDFが出たら import 後にプレビューを確認して必要に応じ追記する。
type CircledOverride = {
  academicYear: number;
  month: number;
  // 注釈本文の先頭が match するパターン(完全一致でなく includes でOKな形にする)
  pattern: string;
  days: number[];
};

const CIRCLED_OVERRIDES: CircledOverride[] = [
  // 2026年度 前期
  // PDF: "①日：開学記念日（5月15日）の振替（休講）"
  // 5/1(金) が振替休講。実運用では翌5/2(土)もブリッジで休講扱い
  // (PDFテキスト上は5/2に注釈なしだが、CIT側で休講通知あり)
  {
    academicYear: 2026,
    month: 5,
    pattern: "開学記念日（5月15日）の振替（休講）",
    days: [1, 2],
  },
  // PDF: "②日：自学自習の日（休講）" → 5/9(土)
  {
    academicYear: 2026,
    month: 5,
    pattern: "自学自習の日（休講）",
    days: [9],
  },
];

const CIRCLED_NUM_RE = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]/;

function classify(title: string): CitParsedEvent["kind"] {
  if (EXAM_KW.some((k) => title.includes(k))) return "EXAM";
  if (HOLIDAY_KW.some((k) => title.includes(k))) return "HOLIDAY";
  return "EVENT";
}

// JST の y/m/d を「DB 上で同じ y/m/d を表現する Date」(JST 0:00 = UTC 前日 15:00) で作る
function jstDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day, -9, 0, 0));
}

export async function fetchCitGakunenrekiPdf(): Promise<Uint8Array> {
  const res = await fetch(PDF_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`千葉工大 学年歴 PDF 取得失敗: ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

type Section = { month: number; year: number; lines: string[] };

/**
 * PDF からテキスト抽出 + 週曜日ヘッダで月セクションに分割。
 * y 座標で行を bucket し x 順で並べてから、" " (space) で連結する。
 * (連結文字を空にすると `30日：x` のような正しい行はOKだが、`|11|20|日：x` の
 *  ような月ラベル混入行で `1120日：x` になりパースできなくなるため、
 *  空白を挟んで lookbehind が効くようにする)
 */
async function extractSections(pdf: Uint8Array): Promise<{
  academicYear: number;
  sections: Section[];
  // ページ前段にあるグリッド外テキスト(履修登録期間など)
  headerLines: string[];
}> {
  const doc = await getDocument({
    data: pdf,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const headerLines: string[] = [];
  const sections: Section[] = [];
  let academicYearText = "";

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    type Item = { str: string; x: number; y: number };
    const items: Item[] = [];
    for (const it of content.items) {
      if (typeof (it as { str?: unknown }).str !== "string") continue;
      const t = it as { transform: number[]; str: string };
      items.push({ str: t.str, x: t.transform[4], y: t.transform[5] });
    }

    // y を 2px 丸めで bucket 化、bucket ごとに x 昇順で連結
    const rows = new Map<number, Item[]>();
    for (const it of items) {
      const yBucket = Math.round(it.y / 2) * 2;
      if (!rows.has(yBucket)) rows.set(yBucket, []);
      rows.get(yBucket)!.push(it);
    }
    const yKeys = [...rows.keys()].sort((a, b) => b - a); // PDF は左下原点
    const lines = yKeys.map((y) =>
      rows
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join(" "),
    );

    if (!academicYearText) academicYearText = lines.join("\n");

    // 週曜日ヘッダ(連続して 日 月 火 水 木 金 土 が並ぶ行)を月セクションの境界に
    const headerIdx: number[] = [];
    lines.forEach((l, i) => {
      // ノイズに耐えるため「日 月 火 水 木 金 土」の各文字が順に出るかをチェック
      const compact = l.replace(/[\s|]+/g, "");
      if (
        /日.*?月.*?火.*?水.*?木.*?金.*?土/.test(compact) &&
        // ヘッダは「全学共通」と同じ行に出ることが多い。誤検知を抑えるため min 長
        compact.length >= 7 &&
        compact.length <= 30
      ) {
        headerIdx.push(i);
      }
    });

    // ヘッダ前のテキスト(「履修登録期間：X月Y日 ～ X月Z日」など)を分離保存
    const beforeHeaders = headerIdx.length > 0 ? lines.slice(0, headerIdx[0]) : lines;
    headerLines.push(...beforeHeaders);

    // 各ヘッダ → 次ヘッダまでを 1 セクション。月並びはページ別固定。
    const monthSeq = PAGE_MONTHS[p - 1] ?? [];
    for (let i = 0; i < headerIdx.length; i++) {
      const start = headerIdx[i];
      const end = headerIdx[i + 1] ?? lines.length;
      const month = monthSeq[i];
      if (!month) continue;
      sections.push({ month, year: 0, lines: lines.slice(start + 1, end) });
    }
  }

  // 学年度を確定し、各 section の暦年を埋める
  const academicYear = detectAcademicYear(academicYearText);
  for (const s of sections) {
    s.year = s.month >= 4 ? academicYear : academicYear + 1;
  }

  return { academicYear, sections, headerLines };
}

function detectAcademicYear(text: string): number {
  const z2h = text.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30),
  );
  const m = z2h.match(/(20\d{2})年度/);
  if (m) return Number(m[1]);
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

// "履修登録期間：4月10日（金） ～ 4月18日（土）" のような月込み完全表記
function parseFullDateRange(line: string, academicYear: number): CitParsedEvent[] {
  const m = line.match(
    /^([^：:\d]{2,30})[:：][^\d]*?(\d{1,2})月\s*(\d{1,2})日[^〜～]*?[〜～][^\d]*?(?:(\d{1,2})月)?\s*(\d{1,2})日/,
  );
  if (!m) return [];
  const title = m[1].trim();
  const m1 = Number(m[2]);
  const d1 = Number(m[3]);
  const m2 = m[4] ? Number(m[4]) : m1;
  const d2 = Number(m[5]);
  const yearOf = (mm: number) => (mm >= 4 ? academicYear : academicYear + 1);
  const out: CitParsedEvent[] = [];
  if (m1 === m2) {
    const y = yearOf(m1);
    for (let d = d1; d <= d2; d++) {
      out.push({ title, date: jstDate(y, m1, d), kind: classify(title) });
    }
  } else {
    out.push({ title, date: jstDate(yearOf(m1), m1, d1), kind: classify(title) });
    out.push({ title, date: jstDate(yearOf(m2), m2, d2), kind: classify(title) });
  }
  return out;
}

// "①日：title" 等の丸数字注釈を CIRCLED_OVERRIDES から日付決定
function parseCircledEntries(
  line: string,
  month: number,
  year: number,
  academicYear: number,
): CitParsedEvent[] {
  if (!CIRCLED_NUM_RE.test(line)) return [];
  const re =
    /([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮])\s*日\s*[:：]\s*([^\n]+?)(?=(?:\s+\d{1,2}\s*日)|(?:\s+[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]\s*日)|$)/g;
  const out: CitParsedEvent[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    let title = m[2].trim();
    title = title
      .replace(/[\s　|]+$/, "")
      .replace(/^[\s　|]+/, "")
      .trim();
    if (!title) continue;
    const cut = title.search(/[\s　]+■[:：]/);
    if (cut > 0) title = title.slice(0, cut).trim();
    const ov = CIRCLED_OVERRIDES.find(
      (o) =>
        o.academicYear === academicYear &&
        o.month === month &&
        title.includes(o.pattern),
    );
    if (!ov) continue;
    for (const day of ov.days) {
      const key = `${month}/${day}|${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title,
        date: jstDate(year, month, day),
        kind: classify(title),
      });
    }
  }
  return out;
}

// 月コンテキスト下の "X日：title" / "X・Y日：title" / "X～Y日：title"
function parseDayLevelEntries(
  line: string,
  month: number,
  year: number,
): CitParsedEvent[] {
  // PDF テキスト抽出は座標 bucket を空白連結するため、`20 日：` のように
  // 「数字」「日」「コロン」の間に空白が混じる。\s* を間にも入れる。
  // タイトルは次の `<数字>日` 出現か行末まで(非貪欲)。
  const patterns: { regex: RegExp; mode: "single" | "list" | "range" }[] = [
    {
      regex: /(?<!月)(?<!\d)(\d{1,2})\s*[～〜]\s*(\d{1,2})\s*日\s*[:：]\s*([^\n]+?)(?=(?:\s+\d{1,2}\s*日)|$)/g,
      mode: "range",
    },
    {
      regex: /(?<!月)(?<!\d)((?:\d{1,2}\s*・\s*){1,5}\d{1,2})\s*日\s*[:：]\s*([^\n]+?)(?=(?:\s+\d{1,2}\s*日)|$)/g,
      mode: "list",
    },
    {
      regex: /(?<!月)(?<!\d)(\d{1,2})\s*日\s*[:：]\s*([^\n]+?)(?=(?:\s+\d{1,2}\s*日)|$)/g,
      mode: "single",
    },
  ];

  const seen = new Set<string>();
  const out: CitParsedEvent[] = [];

  for (const { regex, mode } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = regex.exec(line)) !== null) {
      let title = "";
      const days: number[] = [];
      if (mode === "range") {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (a < 1 || b > 31 || a > b) continue;
        for (let d = a; d <= b; d++) days.push(d);
        title = m[3].trim();
      } else if (mode === "list") {
        for (const s of m[1].split("・").map((x) => x.trim())) {
          const d = Number(s);
          if (d >= 1 && d <= 31) days.push(d);
        }
        title = m[2].trim();
      } else {
        const d = Number(m[1]);
        if (d < 1 || d > 31) continue;
        days.push(d);
        title = m[2].trim();
      }
      // タイトル末尾のゴミ(■、空白、|)を除く
      title = title
        .replace(/[\s　|]+$/, "")
        .replace(/^[\s　|]+/, "")
        .trim();
      if (!title || title.length > 80) continue;
      // タイトル中の「■：xxx」のような後続レジェンドを切り捨て
      const cut = title.search(/[\s　]+■[:：]/);
      if (cut > 0) title = title.slice(0, cut).trim();
      for (const d of days) {
        const key = `${month}/${d}|${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ title, date: jstDate(year, month, d), kind: classify(title) });
      }
    }
  }
  return out;
}

export async function parseCitGakunenreki(): Promise<{
  academicYear: number;
  events: CitParsedEvent[];
}> {
  const pdf = await fetchCitGakunenrekiPdf();
  const { academicYear, sections, headerLines } = await extractSections(pdf);

  const all: CitParsedEvent[] = [];

  // ページ前段の「履修登録期間：…」など
  for (const line of headerLines) {
    all.push(...parseFullDateRange(line, academicYear));
  }

  // 月セクションごとの日次エントリ
  for (const sec of sections) {
    for (const line of sec.lines) {
      all.push(...parseDayLevelEntries(line, sec.month, sec.year));
      all.push(
        ...parseCircledEntries(line, sec.month, sec.year, academicYear),
      );
      // セクション内にも完全表記が混ざる可能性があるので両方試す
      all.push(...parseFullDateRange(line, academicYear));
    }
  }

  // 重複排除
  const seen = new Set<string>();
  const events: CitParsedEvent[] = [];
  for (const e of all) {
    const k = `${e.date.toISOString()}|${e.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    events.push(e);
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  return { academicYear, events };
}
