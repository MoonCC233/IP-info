// 构建脚本：使用 @napi-rs/canvas 预渲染位图资源，供 Worker 纯 JS 渲染器使用
// 产物（写入 public/，作为 Static Assets 由 env.ASSETS 提供，运行时无需解码）：
//   - card_bg.rgba      534×256 RGBA，已合成 bg.jpg + kbn.png 吉祥物
//   - font_atlas.rgba   GB2312(6763) + ASCII 字形图集（17px Bold，棕色）
//   - font_atlas.json   图集布局 + 每字 advance
//
// 这些文件较大（~10MB），不应提交到 git，CI 中由本脚本生成。
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = join(ROOT, "public");
const FONT_PATH = join(PUBLIC, "msyh.ttf");
const BG_PATH = join(PUBLIC, "bg.jpg");
const KBN_PATH = join(PUBLIC, "kbn.png");

const W = 534;
const H = 256;
const FONT_SIZE = 17;
const COLOR = "#5a3825"; // 与 generator.js 中 COLOR_NORMAL 一致
// 吉祥物放置参数，与 generateSVG 中的保持一致
const MASCOT = { x: 300, y: -4, w: 230, h: 260 };

// 字形图集单元格参数
const CELL_W = 20;
const CELL_H = 20;
const CELL_BASELINE = 15; // 单元格内基线 Y（17px Bold：上行 ~14，下行 ~3）
const COLS = 160;

function fail(msg) {
  console.error("[prerender] " + msg);
  process.exit(1);
}

// 构建字符集：ASCII + 常用全角标点 + GB2312 一级二级汉字
function buildCharset() {
  const set = new Set();
  for (let c = 0x20; c <= 0x7e; c++) set.add(c);
  for (const ch of "℃×÷·，。、：；！？“”‘’（）【】《》—…·　") {
    set.add(ch.codePointAt(0));
  }
  // GB2312 汉字：字节范围 B0-F7 / A1-FE，Node 22 自带 ICU 支持 gb2312 解码
  const dec = new TextDecoder("gb2312");
  for (let b1 = 0xb0; b1 <= 0xf7; b1++) {
    for (let b2 = 0xa1; b2 <= 0xfe; b2++) {
      const s = dec.decode(Buffer.from([b1, b2]));
      if (s && s.length === 1) {
        const cp = s.codePointAt(0);
        if (cp >= 0x4e00 && cp <= 0x9fff) set.add(cp);
      }
    }
  }
  return [...set].sort((a, b) => a - b);
}

async function buildBackground() {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const bg = await loadImage(BG_PATH);
  // 等比裁剪铺满 W×H（slice）
  const s = Math.max(W / bg.width, H / bg.height);
  const sw = W / s;
  const sh = H / s;
  const sx = (bg.width - sw) / 2;
  const sy = (bg.height - sh) / 2;
  ctx.drawImage(bg, sx, sy, sw, sh, 0, 0, W, H);

  const kbn = await loadImage(KBN_PATH);
  // preserveAspectRatio="xMidYMax meet"：contain，水平居中、底部对齐
  const scale = Math.min(MASCOT.w / kbn.width, MASCOT.h / kbn.height);
  const dw = kbn.width * scale;
  const dh = kbn.height * scale;
  const dx = MASCOT.x + (MASCOT.w - dw) / 2;
  const dy = MASCOT.y + (MASCOT.h - dh);
  ctx.drawImage(kbn, dx, dy, dw, dh);

  const data = ctx.getImageData(0, 0, W, H).data;
  writeFileSync(join(PUBLIC, "card_bg.rgba"), Buffer.from(data));
  console.log(`[prerender] card_bg.rgba  ${W}x${H}  ${data.length} bytes`);
}

async function buildAtlas() {
  const codes = buildCharset();
  const rows = Math.ceil(codes.length / COLS);
  const atlasW = COLS * CELL_W;
  const atlasH = rows * CELL_H;

  const c = createCanvas(atlasW, atlasH);
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, atlasW, atlasH);
  ctx.font = `700 ${FONT_SIZE}px msyh, "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = COLOR;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const advances = new Array(codes.length);
  for (let i = 0; i < codes.length; i++) {
    const ch = String.fromCodePoint(codes[i]);
    const cx = (i % COLS) * CELL_W;
    const cy = Math.floor(i / COLS) * CELL_H;
    ctx.clearRect(cx, cy, CELL_W, CELL_H);
    ctx.fillText(ch, cx, cy + CELL_BASELINE);
    const m = ctx.measureText(ch);
    advances[i] = Math.max(1, Math.round(m.width));
  }

  const data = ctx.getImageData(0, 0, atlasW, atlasH).data;
  writeFileSync(join(PUBLIC, "font_atlas.rgba"), Buffer.from(data));

  const meta = {
    version: 1,
    cellW: CELL_W,
    cellH: CELL_H,
    baseline: CELL_BASELINE,
    cols: COLS,
    rows,
    count: codes.length,
    atlasW,
    atlasH,
    fontSize: FONT_SIZE,
    color: [90, 56, 37],
    chars: codes.map((cp, i) => [cp, advances[i]]),
  };
  writeFileSync(join(PUBLIC, "font_atlas.json"), JSON.stringify(meta));
  console.log(
    `[prerender] font_atlas   ${codes.length} glyphs  ${atlasW}x${atlasH}  rgba ${data.length} bytes`
  );
}

async function main() {
  for (const p of [FONT_PATH, BG_PATH, KBN_PATH]) {
    if (!existsSync(p)) fail(`缺少资源文件: ${p}`);
  }
  const ok = GlobalFonts.registerFromPath(FONT_PATH, "msyh");
  if (!ok) fail(`注册字体失败: ${FONT_PATH}`);
  console.log(`[prerender] 已注册字体 msyh，可用族: ${GlobalFonts.families.length}`);

  await buildBackground();
  await buildAtlas();
  console.log("[prerender] 完成");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
