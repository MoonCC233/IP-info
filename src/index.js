import { generateInfo, generateSVG, generateHTML } from "./generator.js";
import { svgToJpeg, svgToPng, buildSelfContainedSVG, prepareAssets } from "./image.js";

const CACHE_TTL = 60;
const IMG_CACHE_TTL = 120;

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
        return handleHome(request, env, ctx);
      }

      if (pathname === "/svg" || pathname === "/img") {
        return handleSVG(request, env, ctx);
      }

      if (pathname === "/preview.jpg" || pathname === "/preview.png" || pathname === "/jpg" || pathname === "/png") {
        return handlePreview(request, env, ctx);
      }

      if (pathname === "/api/info") {
        return handleAPI(request, env, ctx);
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

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      console.error("Worker error:", err);
      return new Response("Internal Server Error", { status: 500 });
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
  const origin = url.origin;
  const info = await generateInfo(request);
  info.baseUrl = origin;
  const queryText = decodeURIComponent(url.searchParams.get("s") || "");
  const scale = url.searchParams.get("scale") === "2" ? 2 : 1;

  const [assets, svg] = await Promise.all([
    prepareAssets(origin, env),
    Promise.resolve(generateSVG(info, queryText)),
  ]);
  const standaloneSVG = buildSelfContainedSVG(svg, origin, assets);

  // 默认输出 JPEG（体积小、兼容性好），明确请求 .png 时输出 PNG
  const isPng = /\.png$|\/png$/.test(url.pathname);
  let body;
  let contentType;
  if (isPng) {
    body = await svgToPng(standaloneSVG, { scale, fontBuffer: assets.fontBuffer });
    contentType = "image/png";
  } else {
    body = await svgToJpeg(standaloneSVG, { scale, quality: 92, fontBuffer: assets.fontBuffer });
    contentType = "image/jpeg";
  }

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