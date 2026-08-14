import { assetBytesByModule } from "./_assets/manifest.js";

const W = 534;
const H = 256;
const FONT_SIZE = 17;
const FONT_SIZE_SMALL = 15;
const TEXT_X = 20;
const COLOR_NORMAL = "#5a3825";
const COLOR_SMALL = "#6b4a35";

const CanvasClass = typeof Canvas !== "undefined" ? Canvas : (typeof globalThis !== "undefined" && globalThis.Canvas) || null;
const ImageClass = typeof Image !== "undefined" ? Image : (typeof globalThis !== "undefined" && globalThis.Image) || null;
const FontFaceClass = typeof FontFace !== "undefined" ? FontFace : (typeof globalThis !== "undefined" && globalThis.FontFace) || null;

if (!CanvasClass) {
  throw new Error("Canvas API not available in this runtime");
}

let imagesCache = null;
let fontBuffer = null;

function bytesToDataURI(bytes, mime) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function createImage(bytes, mime) {
  const img = new ImageClass();
  img.src = bytesToDataURI(bytes, mime);
  return img;
}

async function loadImages(env) {
  if (imagesCache) return imagesCache;

  const [bg, kbn] = await Promise.all([
    loadAsset("/bg.jpg", env),
    loadAsset("/kbn.png", env),
  ]);

  imagesCache = {
    bg: createImage(bg, "image/jpeg"),
    kbn: createImage(kbn, "image/png"),
  };
  return imagesCache;
}

async function loadFont(env) {
  if (fontBuffer) return fontBuffer;
  fontBuffer = await loadAsset("/msyh.ttf", env);
  return fontBuffer;
}

async function loadAsset(relPath, env) {
  const cleanRel = relPath.startsWith("/") ? relPath.slice(1) : relPath;

  try {
    const buf = assetBytesByModule("/" + cleanRel);
    if (buf && buf.length) return buf;
  } catch (_) {}

  const binding = env && env.ASSETS;
  if (binding && typeof binding.fetch === "function") {
    const fakeUrl = `https://assets.local/${cleanRel}`;
    const r = await binding.fetch(new Request(fakeUrl));
    if (r && r.ok) return new Uint8Array(await r.arrayBuffer());
  }

  throw new Error(`Asset not found: ${relPath}`);
}

let fontReadyPromise = null;
async function ensureFont(ctx, fontBuf) {
  if (fontReadyPromise) return fontReadyPromise;
  fontReadyPromise = (async () => {
    try {
      if (FontFaceClass) {
        const fontFace = new FontFaceClass("msyh", fontBuf);
        await fontFace.load();
      }
      ctx.font = "700 17px msyh, 'Microsoft YaHei', 'PingFang SC', sans-serif";
      return true;
    } catch (_) {
      ctx.font = "700 17px sans-serif";
      return false;
    }
  })();
  return fontReadyPromise;
}

function computeTextLayout(textLines) {
  const ASCENT_RATIO = 0.85;
  const DESCENT_RATIO = 0.22;
  let firstTop = Infinity;
  let lastBottom = -Infinity;

  for (const line of textLines) {
    const fs = line.small ? FONT_SIZE_SMALL : FONT_SIZE;
    const top = line.y - fs * ASCENT_RATIO;
    const bottom = line.y + fs * DESCENT_RATIO;
    if (top < firstTop) firstTop = top;
    if (bottom > lastBottom) lastBottom = bottom;
  }

  const blockHeight = lastBottom - firstTop;
  const targetPadding = (H - blockHeight) / 2;
  const offsetY = Math.round(targetPadding - firstTop);

  return textLines.map((line) => ({ ...line, y: line.y + offsetY }));
}

function drawUnderline(ctx, text, x, y, fontSize, color) {
  ctx.font = `700 ${fontSize}px msyh, 'Microsoft YaHei', sans-serif`;
  const metrics = ctx.measureText(text);
  const lineW = Math.max(1, Math.round(metrics.width * 0.98));
  const lineY = y + Math.round(fontSize / 6) + 3;
  const lineH = Math.max(1, Math.round(fontSize / 12));

  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = lineH;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, lineY);
  ctx.lineTo(x + lineW, lineY);
  ctx.stroke();
  ctx.restore();
}

function drawAll(ctx, info, queryText, images) {
  ctx.clearRect(0, 0, W, H);

  ctx.drawImage(images.bg, 0, 0, W, H);

  const mascotX = 300;
  const mascotY = -4;
  const mascotW = 230;
  const mascotH = 260;
  ctx.drawImage(images.kbn, mascotX, mascotY, mascotW, mascotH);

  const textLines = [];
  textLines.push({ text: `欢迎您来自${info.location}的朋友`, y: 35 });

  let dateLine = `今天是${info.dateStr} ${info.weekStr}`;
  if (info.weather) dateLine += `  ${info.weather.text}`;
  textLines.push({ text: dateLine, y: 72 });

  textLines.push({ text: `您的IP是:${info.ip}`, y: 110 });
  textLines.push({ text: `您使用的是${info.os}操作系统`, y: 148 });
  textLines.push({ text: `您使用的是${info.browser}`, y: 186 });

  if (queryText) {
    textLines.push({ text: queryText, y: 220, small: true });
  }

  const adjusted = computeTextLayout(textLines);

  for (const line of adjusted) {
    const fs = line.small ? FONT_SIZE_SMALL : FONT_SIZE;
    const color = line.small ? COLOR_SMALL : COLOR_NORMAL;

    ctx.font = `700 ${fs}px msyh, 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif`;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(line.text, TEXT_X, line.y);

    drawUnderline(ctx, line.text, TEXT_X, line.y, fs, color);
  }
}

export async function renderBitmap(info, queryText, env, format) {
  const canvas = new CanvasClass(W, H);
  const ctx = canvas.getContext("2d");

  const [images, fontBuf] = await Promise.all([
    loadImages(env),
    loadFont(env),
  ]);

  await ensureFont(ctx, fontBuf);

  drawAll(ctx, info, queryText, images);

  if (format === "png") {
    return new Uint8Array(canvas.toBuffer("image/png"));
  }
  return new Uint8Array(canvas.toBuffer("image/jpeg", { quality: 0.92 }));
}

export function resetCache() {
  imagesCache = null;
  fontBuffer = null;
  fontReadyPromise = null;
}
