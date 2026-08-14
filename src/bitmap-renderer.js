// 纯 JS 位图渲染器：将预渲染的背景与字形图集合成，输出 PNG
// 适配 Cloudflare Workers 免费版 10ms CPU 限制：
//   - 背景与字形图集均为预渲染 RGBA，运行时无需解码（仅 I/O，不计 CPU）
//   - 字形通过 alpha 混合 blit 到背景缓冲
//   - PNG 编码使用原生 CompressionStream（不计 JS CPU）
// 资源经 env.ASSETS 加载后在 isolate 内缓存复用。
import { fetchAssetBytesPublic } from "./image.js";
import { encodePNG } from "./png-encoder.js";

const W = 534;
const H = 256;
const STRIDE = W * 4;
const TEXT_X = 20;
const FONT_SIZE = 17;
const COLOR_NORMAL = [90, 56, 37]; // #5a3825
const COLOR_SMALL = [107, 74, 53]; // #6b4a35

let cachePromise = null;

async function loadAssets(env) {
  const [bgBytes, atlasBytes, metaBytes] = await Promise.all([
    fetchAssetBytesPublic("", "/card_bg.rgba", env, { allowHttpFallback: false }),
    fetchAssetBytesPublic("", "/font_atlas.rgba", env, { allowHttpFallback: false }),
    fetchAssetBytesPublic("", "/font_atlas.json", env, { allowHttpFallback: false }),
  ]);
  const meta = JSON.parse(new TextDecoder().decode(metaBytes));
  const map = new Map();
  for (let i = 0; i < meta.chars.length; i++) {
    const [cp, adv] = meta.chars[i];
    map.set(cp, { i, adv });
  }
  return {
    bg: new Uint8Array(
      bgBytes.buffer,
      bgBytes.byteOffset,
      bgBytes.byteLength
    ),
    atlas: new Uint8Array(
      atlasBytes.buffer,
      atlasBytes.byteOffset,
      atlasBytes.byteLength
    ),
    meta,
    map,
  };
}

function getAssets(env) {
  if (!cachePromise) {
    cachePromise = loadAssets(env).catch((e) => {
      cachePromise = null;
      throw e;
    });
  }
  return cachePromise;
}

// 与 generator.js 一致的垂直居中布局
function computeTextLayout(textLines) {
  const ASCENT_RATIO = 0.85;
  const DESCENT_RATIO = 0.22;
  let firstTop = Infinity;
  let lastBottom = -Infinity;
  for (const line of textLines) {
    const fs = line.small ? 15 : FONT_SIZE;
    const top = line.y - fs * ASCENT_RATIO;
    const bottom = line.y + fs * DESCENT_RATIO;
    if (top < firstTop) firstTop = top;
    if (bottom > lastBottom) lastBottom = bottom;
  }
  const blockHeight = lastBottom - firstTop;
  const targetPadding = (H - blockHeight) / 2;
  const offsetY = Math.round(targetPadding - firstTop);
  return textLines.map((l) => ({ ...l, y: l.y + offsetY }));
}

function blitCell(buf, atlas, meta, dx, dy, idx) {
  const { cellW, cellH, cols, atlasW } = meta;
  const cx = (idx % cols) * cellW;
  const cy = Math.floor(idx / cols) * cellH;
  for (let y = 0; y < cellH; y++) {
    const dyy = dy + y;
    if (dyy < 0 || dyy >= H) continue;
    for (let x = 0; x < cellW; x++) {
      const dxx = dx + x;
      if (dxx < 0 || dxx >= W) continue;
      const si = ((cy + y) * atlasW + (cx + x)) * 4;
      const sa = atlas[si + 3];
      if (sa === 0) continue;
      const di = (dyy * W + dxx) * 4;
      if (sa === 255) {
        buf[di] = atlas[si];
        buf[di + 1] = atlas[si + 1];
        buf[di + 2] = atlas[si + 2];
      } else {
        const a = sa / 255;
        const ia = 1 - a;
        buf[di] = atlas[si] * a + buf[di] * ia;
        buf[di + 1] = atlas[si + 1] * a + buf[di + 1] * ia;
        buf[di + 2] = atlas[si + 2] * a + buf[di + 2] * ia;
      }
    }
  }
}

function measureLineWidth(map, text) {
  let w = 0;
  for (const ch of text) {
    const g = map.get(ch.codePointAt(0));
    w += g ? g.adv : FONT_SIZE;
  }
  return w;
}

function drawTextLine(buf, atlas, meta, map, text, baselineY) {
  let penX = TEXT_X;
  for (const ch of text) {
    const g = map.get(ch.codePointAt(0));
    if (g) {
      blitCell(buf, atlas, meta, penX, baselineY - meta.baseline, g.i);
      penX += g.adv;
    } else {
      penX += FONT_SIZE; // 缺字留白前进
    }
  }
}

function fillRectBlend(buf, x, y, w, h, color, alpha) {
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(H, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return;
  const ia = 1 - alpha;
  const r = color[0] * alpha;
  const g = color[1] * alpha;
  const b = color[2] * alpha;
  for (let yy = y0; yy < y1; yy++) {
    const rowBase = yy * W;
    for (let xx = x0; xx < x1; xx++) {
      const di = (rowBase + xx) * 4;
      buf[di] = r + buf[di] * ia;
      buf[di + 1] = g + buf[di + 1] * ia;
      buf[di + 2] = b + buf[di + 2] * ia;
    }
  }
}

function buildTextLines(info, queryText) {
  const lines = [];
  lines.push({ text: `欢迎您来自${info.location}的朋友`, y: 35, small: false });
  let dateLine = `今天是${info.dateStr} ${info.weekStr}`;
  if (info.weather) dateLine += `  ${info.weather.text}`;
  lines.push({ text: dateLine, y: 72, small: false });
  lines.push({ text: `您的IP是:${info.ip}`, y: 110, small: false });
  lines.push({ text: `您使用的是${info.os}操作系统`, y: 148, small: false });
  lines.push({ text: `您使用的是${info.browser}`, y: 186, small: false });
  if (queryText) lines.push({ text: queryText, y: 220, small: true });
  return lines;
}

export async function renderBitmap(info, queryText, env, format) {
  const { bg, atlas, meta, map } = await getAssets(env);

  // 复制背景到工作缓冲
  const buf = new Uint8Array(W * H * 4);
  buf.set(bg);

  const textLines = computeTextLayout(buildTextLines(info, queryText));

  // 先画下划线（在文字下方），再叠加文字
  for (const line of textLines) {
    const fs = line.small ? 15 : FONT_SIZE;
    const color = line.small ? COLOR_SMALL : COLOR_NORMAL;
    const lineY = line.y + Math.round(fs / 6) + 3;
    const lineH = Math.max(1, Math.round(fs / 12));
    const lineW = measureLineWidth(map, line.text);
    fillRectBlend(buf, TEXT_X, lineY, lineW, lineH, color, 0.85);
  }

  for (const line of textLines) {
    drawTextLine(buf, atlas, meta, map, line.text, line.y);
  }

  // 纯 JS 无法在 10ms 内完成 JPEG 编码，/jpg 与 /png 均输出 PNG
  return await encodePNG(buf, W, H);
}

export function resetCache() {
  cachePromise = null;
}
