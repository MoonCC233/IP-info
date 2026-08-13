import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import jpeg from "jpeg-js";
import { assetBytesByModule } from "./_assets/manifest.js";

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
  // prepareAssets 内部调用：允许 HTTP fallback（本地 dev / 旧部署兼容），但增加内部递归标记防死循环
  return fetchAssetBytesPublic(baseUrl, relPath, env, { allowHttpFallback: true });
}

// 取 env 上所有可能作为候选 binding 的 key（含 ASSET/STATIC 名称 或 有 fetch 方法）
function enumerateAssetBindingCandidates(env) {
  if (!env || typeof env !== "object") return [];
  const seen = new Set();
  const keys = [];
  const pushKey = (k) => {
    const s = String(k);
    if (!seen.has(s)) {
      seen.add(s);
      keys.push(s);
    }
  };
  try { for (const k of Reflect.ownKeys(env)) pushKey(k); } catch (_) {}
  try { for (const k in env) pushKey(k); } catch (_) {}
  const hardcoded = ["ASSETS", "__ASSETS", "__STATIC_CONTENT", "STATIC_CONTENT", "ASSET", "STATIC", "SITE", "SITE_BUCKET", "ASSETS_BUCKET", "__ASSET_MANIFEST", "MANIFEST"];
  hardcoded.forEach(pushKey);
  // 优先级：名字里包含 ASSET/STATIC/SITE 的靠前（更可能是 Assets binding），剩下的有 fetch 方法的也尝试
  const score = (name) => {
    const up = name.toUpperCase();
    if (up.includes("ASSET")) return 0;
    if (up.includes("STATIC")) return 1;
    if (up.includes("SITE")) return 2;
    if (up.includes("MANIFEST")) return 3;
    return 10;
  };
  keys.sort((a, b) => score(a) - score(b));
  return keys;
}

// 公开版本：供 Worker 路由层直接调用（静态文件直出 & 诊断）
// opts.allowHttpFallback: false 时禁止 HTTP self-fetch（避免 handleStatic 内部递归）
export async function fetchAssetBytesPublic(baseUrl, relPath, env, opts) {
  const allowHttpFallback = !(opts && opts.allowHttpFallback === false);
  const cleanRel = relPath.startsWith("/") ? relPath.slice(1) : relPath;
  const slashKey = "/" + cleanRel;

  // 优先级 1：Data 模块导入（wrangler rules=Data，不计入 script size 限制，最稳）
  try {
    const buf = assetBytesByModule(slashKey);
    if (buf && buf.length) return buf;
  } catch (_) {}

  // 优先级 2：Assets binding（如果 wrangler 正确注入了 binding）
  const candidateNames = enumerateAssetBindingCandidates(env);
  const triedBindings = [];
  const triedBindingWithFetch = [];
  for (const name of candidateNames) {
    let binding;
    try { binding = env[name]; } catch (_) { binding = undefined; }
    if (!binding || typeof binding.fetch !== "function") continue;
    triedBindingWithFetch.push(name);
    const up = name.toUpperCase();
    const looksLikeAssets = /ASSET|STATIC|SITE|MANIFEST/.test(up);
    triedBindings.push(name + (looksLikeAssets ? "" : "?"));
    const candidates = looksLikeAssets
      ? [
          () => binding.fetch(`/${cleanRel}`),
          () => binding.fetch(cleanRel),
          () => binding.fetch(new Request(`/${cleanRel}`)),
          () => binding.fetch(new Request(cleanRel)),
        ]
      : [
          () => binding.fetch(`/${cleanRel}`),
          () => binding.fetch(cleanRel),
        ];
    for (const fn of candidates) {
      try {
        const r = await fn();
        if (r && r.ok) return new Uint8Array(await r.arrayBuffer());
      } catch (_) { /* 继续试下一个 */ }
    }
  }

  if (!allowHttpFallback) {
    const triedMsg = triedBindings.length ? ` (tried bindings: ${triedBindings.join(",")})` : " (no fetch-capable env bindings)";
    throw new Error(`Assets binding 未找到${triedMsg}，已跳过 HTTP fallback 防递归`);
  }

  // 优先级 3：HTTP fetch 自身域名路径（兼容本地 dev / 旧部署）
  // 加 __assets_direct=1，若被 Worker 再次接收直接回 410 断链，避免递归
  try {
    const u = new URL(relPath, baseUrl);
    u.searchParams.set("__assets_direct", "1");
    const abs = u.href;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let resp;
    try {
      resp = await fetch(abs, {
        signal: ctrl.signal,
        redirect: "manual",
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
    } finally {
      clearTimeout(timer);
    }
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location") || "";
      throw new Error(`asset ${abs} -> redirect ${resp.status} ${loc}`);
    }
    if (!resp.ok) throw new Error(`asset ${abs} -> ${resp.status}`);
    return new Uint8Array(await resp.arrayBuffer());
  } catch (err) {
    const triedMsg = triedBindings.length ? ` (tried bindings: ${triedBindings.join(",")}, fetchBindings: ${triedBindingWithFetch.join(",")})` : triedBindingWithFetch.length ? ` (fetchBindings: ${triedBindingWithFetch.join(",")})` : " (no fetch-capable env bindings)";
    err.message = (err && err.message ? err.message : String(err)) + triedMsg;
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
