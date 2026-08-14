import { generateInfo, generateSVG, generateHTML } from "./generator.js";
import { fetchAssetBytesPublic } from "./image.js";
import { renderBitmap } from "./bitmap-renderer.js";

const CACHE_TTL = 60;
const IMG_CACHE_TTL = 120;
const STATIC_FILES = new Set(["/bg.jpg", "/kbn.png", "/msyh.ttf", "/favicon.ico"]);
const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      if (pathname === "/" || pathname === "") {
        return await handleHome(request, env, ctx);
      }

      if (pathname === "/svg" || pathname === "/img") {
        return await handleSVG(request, env, ctx);
      }

      if (pathname === "/preview.jpg" || pathname === "/preview.png" || pathname === "/jpg" || pathname === "/png") {
        return await handlePreview(request, env, ctx);
      }

      if (pathname === "/api/info") {
        return await handleAPI(request, env, ctx);
      }

      if (pathname === "/health") {
        return new Response(
          JSON.stringify({ status: "ok", timestamp: Date.now() }),
          {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          }
        );
      }

      // 静态文件路由：直接从 Assets 读取，避免 self-fetch 触发递归/522
      if (STATIC_FILES.has(pathname)) {
        return await handleStatic(request, env, ctx, pathname);
      }

      // 诊断端点：显示 env 上所有 binding 名（仅名字，不含值）以及各 Assets binding 能否拿到 bg.jpg
      if (pathname === "/debug") {
        return handleDebug(env);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      console.error("Worker error:", err);
      // 将非敏感错误信息暴露到响应体，便于线上定位（不包含 stack / env）
      const msg = err && err.message ? String(err.message) : "unknown error";
      const body =
        request.method === "GET" && /^\/(preview\.(jpg|png)|jpg|png|svg)$/.test(new URL(request.url).pathname.replace(/\/+$/, "") || "/")
          ? `Internal Server Error: ${msg.replace(/\s+/g, " ").slice(0, 300)}`
          : "Internal Server Error";
      return new Response(body, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8", "X-Error": encodeURIComponent(msg).slice(0, 512) },
      });
    }
  },
};

async function handleHome(request, env, ctx) {
  const info = await generateInfo(request);
  info.baseUrl = new URL(request.url).origin;
  const svg = generateSVG(info);

  const html = generateHTML(info, svg);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleSVG(request, env, ctx) {
  const info = await generateInfo(request);
  info.baseUrl = new URL(request.url).origin;

  const queryText = decodeURIComponent(new URL(request.url).searchParams.get("s") || "");
  const svg = generateSVG(info, queryText);

  const headers = {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
    "Access-Control-Allow-Origin": "*",
  };

  const etag = `W/"${hashString(svg)}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { etag, ...headers } });
  }

  headers["etag"] = etag;

  return new Response(svg, { headers });
}

async function handlePreview(request, env, ctx) {
  const url = new URL(request.url);
  const info = await generateInfo(request);
  const queryText = decodeURIComponent(url.searchParams.get("s") || "");

  // 纯 JS 渲染仅产出 PNG（JPEG 编码无法在 10ms CPU 内完成），
  // /jpg 与 /png 均返回 PNG；camo 与 <img> 按 Content-Type 渲染，README 兼容。
  const body = await renderBitmap(info, queryText, env, "png");

  const contentType = "image/png";
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": `public, max-age=${IMG_CACHE_TTL}, s-maxage=${IMG_CACHE_TTL}`,
    "Access-Control-Allow-Origin": "*",
  };

  const etag = `W/"${hashBytes(body)}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { etag, ...headers } });
  }
  headers["etag"] = etag;

  return new Response(body, { headers });
}

async function handleAPI(request, env, ctx) {
  const info = await generateInfo(request);

  const response = {
    ip: info.ip,
    location: info.location,
    country: info.country,
    region: info.region,
    city: info.city,
    os: info.os,
    browser: info.browser,
    dateStr: info.dateStr,
    weekStr: info.weekStr,
    weather: info.weather,
    timestamp: info.timestamp,
  };

  return new Response(JSON.stringify(response, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_TTL}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function hashBytes(bytes) {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function handleStatic(request, env, ctx, pathname) {
  const url = new URL(request.url);
  // 兜底：如果请求带 __assets_direct=1，说明它来自 prepareAssets 的 HTTP fallback，
  // 而现在又落到了 Worker 路由，证明 Assets 绑定失效且 self-fetch 在递归。
  // 直接拒绝，禁止再调用 fetchAssetBytesPublic，避免死循环。
  if (url.searchParams.get("__assets_direct") === "1") {
    return new Response(
      "Assets binding missing: static files served by worker loop detected, aborted to prevent infinite recursion",
      { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }
    );
  }
  // handleStatic 内部禁止 HTTP fallback（如果 Assets binding 失效就直接报错，不再 self-fetch）
  const bytes = await fetchAssetBytesPublic(url.origin, pathname, env, { allowHttpFallback: false });
  const ext = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();
  const ct = MIME_BY_EXT[ext] || "application/octet-stream";
  return new Response(bytes, {
    headers: {
      "Content-Type": ct,
      "Cache-Control": `public, max-age=86400, s-maxage=86400, immutable`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleDebug(env) {
  // 仅返回 binding 名称列表和 Assets 探测结果，绝不暴露值
  const names = [];
  if (env && typeof env === "object") {
    const seen = new Set();
    const push = (k) => {
      const s = String(k);
      if (seen.has(s)) return;
      seen.add(s);
      try {
        const v = env[s];
        const type = v === null || v === undefined ? String(v) : typeof v;
        const hasFetch = !!(v && typeof v.fetch === "function");
        names.push({ name: s, type, hasFetch });
      } catch (_) {
        names.push({ name: s, type: "error" });
      }
    };
    try { for (const k of Reflect.ownKeys(env)) push(k); } catch (_) {}
    try { for (const k in env) push(k); } catch (_) {}
    const extra = ["ASSETS", "__ASSETS", "__STATIC_CONTENT", "STATIC_CONTENT", "ASSET", "STATIC", "SITE", "SITE_BUCKET", "ASSETS_BUCKET", "__ASSET_MANIFEST", "MANIFEST"];
    extra.forEach(push);
  }
  // 枚举所有"有 fetch 方法"的 binding，探测能否拿到 bg.jpg
  const probes = [];
  const seenProbeNames = new Set();
  for (const item of names) {
    if (!item.hasFetch) continue;
    seenProbeNames.add(item.name);
    const binding = env[item.name];
    const cleanRel = "bg.jpg";
    const attempts = [
      { label: "/bg.jpg string", fn: () => binding.fetch(`/${cleanRel}`) },
      { label: "bg.jpg string", fn: () => binding.fetch(cleanRel) },
      { label: "/bg.jpg Request", fn: () => binding.fetch(new Request(`/${cleanRel}`)) },
      { label: "bg.jpg Request", fn: () => binding.fetch(new Request(cleanRel)) },
    ];
    const results = [];
    for (const a of attempts) {
      try {
        const r = await a.fn();
        results.push({ label: a.label, ok: !!(r && r.ok), status: r ? r.status : null });
      } catch (e) {
        results.push({ label: a.label, ok: false, error: e && e.message ? e.message : String(e) });
      }
    }
    probes.push({ name: item.name, available: true, attempts: results });
  }
  // 确保用户已知的三个候选即使没有 fetch 也在 probes 里显示原因
  const mustShow = ["ASSETS", "__ASSETS", "__STATIC_CONTENT"];
  for (const name of mustShow) {
    if (seenProbeNames.has(name)) continue;
    const binding = env && env[name];
    if (!binding || typeof binding.fetch !== "function") {
      probes.push({ name, available: false, reason: binding ? "binding exists but no .fetch" : "no binding" });
    }
  }
  return new Response(JSON.stringify({ bindings: names, assetsProbes: probes }, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}