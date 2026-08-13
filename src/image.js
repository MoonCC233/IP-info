import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import jpeg from "jpeg-js";

let wasmReady = false;
async function ensureWasm() {
  if (!wasmReady) {
    await initWasm(resvgWasm);
    wasmReady = true;
  }
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}

async function fetchAssetBytes(baseUrl, relPath, env) {
  try {
    const abs = new URL(relPath, baseUrl).href;
    const resp = await fetch(abs, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!resp.ok) throw new Error(`asset ${abs} -> ${resp.status}`);
    return new Uint8Array(await resp.arrayBuffer());
  } catch (err) {
    if (env && env.__ASSETS) {
      try {
        const r = await env.__ASSETS.fetch(new Request(relPath));
        if (r.ok) return new Uint8Array(await r.arrayBuffer());
      } catch (_) {}
    }
    throw err;
  }
}

// 同时拿 SVG 内嵌所需的 data URI 和字体二进制，避免重复 fetch
export async function prepareAssets(baseUrl, env) {
  const [bg, kbn, font] = await Promise.all([
    fetchAssetBytes(baseUrl, "/bg.jpg", env),
    fetchAssetBytes(baseUrl, "/kbn.png", env),
    fetchAssetBytes(baseUrl, "/msyh.ttf", env),
  ]);
  return {
    bgURI: `data:image/jpeg;base64,${bytesToBase64(bg)}`,
    kbnURI: `data:image/png;base64,${bytesToBase64(kbn)}`,
    fontURI: `data:font/truetype;base64,${bytesToBase64(font)}`,
    fontBuffer: font,
  };
}

export function buildSelfContainedSVG(baseSvg, baseUrl, assets) {
  let svg = baseSvg;
  const assetPrefix = baseUrl.replace(/\/+$/, "");
  svg = svg.split(`${assetPrefix}/bg.jpg`).join(assets.bgURI);
  svg = svg.split(`${assetPrefix}/kbn.png`).join(assets.kbnURI);
  svg = svg.split(`${assetPrefix}/msyh.ttf`).join(assets.fontURI);
  return svg;
}

function resvgFontOptions(fontBuffer) {
  return {
    fontBuffers: fontBuffer ? [fontBuffer] : undefined,
    defaultFontFamily: "msyh",
    sansSerifFamily: "msyh",
    serifFamily: "serif",
    monospaceFamily: "monospace",
  };
}

// SVG → JPEG：resvg 渲染 → pixels (RGBA) → jpeg-js 编码
export async function svgToJpeg(svgText, options = {}) {
  await ensureWasm();
  const resvg = new Resvg(svgText, {
    fitTo: options.scale === 2 ? { mode: "zoom", value: 2 } : undefined,
    background: "#f2e7d8", // 米色背景，与原插画底色相近，避免突兀白边
    font: resvgFontOptions(options.fontBuffer),
  });
  const rendered = resvg.render();
  const jpegData = jpeg.encode(
    {
      data: rendered.pixels,
      width: rendered.width,
      height: rendered.height,
    },
    options.quality || 92
  );
  return new Uint8Array(jpegData.data);
}

// SVG → PNG：resvg 渲染 → asPng()
export async function svgToPng(svgText, options = {}) {
  await ensureWasm();
  const resvg = new Resvg(svgText, {
    fitTo: options.scale === 2 ? { mode: "zoom", value: 2 } : undefined,
    font: resvgFontOptions(options.fontBuffer),
  });
  const pngData = resvg.render().asPng();
  return new Uint8Array(pngData);
}
