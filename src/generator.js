import { parseUA } from "./ua-parser.js";
import { getWeather } from "./weather.js";

const WEEK_MAP = ["日", "一", "二", "三", "四", "五", "六"];

function isLocalOrPrivateIp(ip) {
  if (!ip) return false;
  const ipStr = ip.trim().toLowerCase();
  // IPv6 回环 / ULA / 链路本地
  if (ipStr === "::1" || ipStr === "0:0:0:0:0:0:0:1") return true;
  if (ipStr.startsWith("fc") || ipStr.startsWith("fd")) return true;
  if (ipStr.startsWith("fe80:")) return true;
  // IPv4 分段匹配
  const v4Match = ipStr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/\d{1,2})?$/);
  if (!v4Match) return false;
  const a = Number(v4Match[1]);
  const b = Number(v4Match[2]);
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

async function ipGeoLookup(ip) {
  try {
    const res = await fetch(`https://uapis.cn/api/v1/network/ipinfo?ip=${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    if (data.region && data.region !== "*") {
      // region 格式: "中国 江苏 南京"
      const parts = data.region.split(/\s+/).filter(Boolean);
      return {
        country: parts[0] || "",
        region: parts[1] || "",
        city: parts[2] || "",
        latitude: data.latitude,
        longitude: data.longitude,
      };
    }
  } catch (_e) {
    // 网络超时或请求失败，忽略
  }
  return null;
}

export async function generateInfo(request) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  const ua = request.headers.get("user-agent") || "";
  const { os, browser } = parseUA(ua);

  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const weekStr = `星期${WEEK_MAP[now.getDay()]}`;

  let country = "";
  let region = "";
  let city = "";
  let latitude = undefined;
  let longitude = undefined;
  let location = "未知地区";
  let weather = null;

  if (isLocalOrPrivateIp(ip)) {
    location = "本地地址";
  } else {
    const cf = request.cf || {};
    const geo = await ipGeoLookup(ip);
    country = geo?.country || cf.country || "";
    region = geo?.region || cf.region || cf.regionCode || "";
    city = geo?.city || cf.city || "";
    latitude = geo?.latitude ?? cf.latitude;
    longitude = geo?.longitude ?? cf.longitude;

    const locationParts = [country, region, city].filter(Boolean);
    if (locationParts.length > 0) {
      location = locationParts.join("-");
    }
    weather = await getWeather(latitude, longitude);
  }

  return {
    ip,
    os,
    browser,
    location,
    country,
    region,
    city,
    dateStr,
    weekStr,
    weather,
    timestamp: now.toISOString(),
  };
}

export function generateSVG(info, queryText = "") {
  const W = 534;
  const H = 256;
  const base = info.baseUrl || "";

  const textLines = [];

  textLines.push({ text: `欢迎您来自${info.location}的朋友`, y: 35 });
  let dateLine = `今天是${info.dateStr} ${info.weekStr}`;
  if (info.weather) {
    dateLine += `  ${info.weather.text}`;
  }
  textLines.push({ text: dateLine, y: 72 });

  textLines.push({ text: `您的IP是:${info.ip}`, y: 110 });

  textLines.push({ text: `您使用的是${info.os}操作系统`, y: 148 });
  textLines.push({ text: `您使用的是${info.browser}`, y: 186 });

  if (queryText) {
    textLines.push({ text: queryText, y: 220, small: true });
  }

  const TEXT_X = 20;
  const FONT_SIZE = 17;
  const FONT_SIZE_SMALL = 15;

  // 计算文字块的整体偏移，使其在 SVG 内垂直居中（第一行顶部到顶端距离 = 最后一行底部到底端距离）
  {
    const ASCENT_RATIO = 0.85; // 微软雅黑 Bold：字形顶部在基线上方约 0.85em
    const DESCENT_RATIO = 0.22; // 字形底部在基线下方约 0.22em
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
    if (offsetY !== 0) {
      for (const line of textLines) line.y += offsetY;
    }
  }
  // 逐字符精确估算下划线长度（基于微软雅黑 Bold 的实际字形宽度校准）
  function underlineWidth(str, fontSize) {
    let w = 0;
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (
        // CJK 统一汉字 / 兼容汉字 / 全角标点 / 平假名片假名 / 中文符号 → 1em
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xff00 && code <= 0xffef) ||
        (code >= 0x3000 && code <= 0x303f) ||
        (code >= 0x3040 && code <= 0x30ff) ||
        ch === "℃" || ch === "×" || ch === "÷"
      ) {
        w += fontSize * 1.0;
      } else if (code >= 0x41 && code <= 0x5a) {
        // A-Z 大写字母 → 0.58em
        w += fontSize * 0.58;
      } else if (code >= 0x61 && code <= 0x7a) {
        // a-z 小写字母 → 0.5em
        w += fontSize * 0.5;
      } else if (code >= 0x30 && code <= 0x39) {
        // 0-9 数字 → 0.5em
        w += fontSize * 0.5;
      } else if (ch === " " || ch === "\t") {
        // 空格 → 0.25em
        w += fontSize * 0.25;
      } else if (ch === ":" || ch === "." || ch === "," || ch === ";" || ch === "`" || ch === "'" || ch === "·") {
        // 细标点 → 0.25em
        w += fontSize * 0.25;
      } else if (ch === "-" || ch === "_" || ch === "/" || ch === "\\" || ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "{" || ch === "}" || ch === "<" || ch === ">") {
        // 括号/斜杠类 → 0.3em
        w += fontSize * 0.3;
      } else if (ch === "!" || ch === "?" || ch === "@" || ch === "#" || ch === "$" || ch === "%" || ch === "^" || ch === "&" || ch === "*" || ch === "+" || ch === "=" || ch === "~" || ch === "|" || ch === "\"") {
        // 其他半角符号 → 0.4em
        w += fontSize * 0.4;
      } else {
        // 未知字符保守取 0.6em
        w += fontSize * 0.6;
      }
    }
    // 收尾收紧 2%，宁可略短不要长出
    return Math.max(fontSize, Math.round(w * 0.98));
  }

  const mascotX = 300;
  const mascotY = -4;
  const mascotW = 230;
  const mascotH = 260;

  const textEls = [];
  textLines.forEach((line) => {
    const fs = line.small ? FONT_SIZE_SMALL : FONT_SIZE;
    const color = line.small ? "#6b4a35" : "#5a3825";
    const lineH = Math.max(1, Math.round(fs / 12));
    const lineY = line.y + Math.round(fs / 6) + 3;
    const lineW = underlineWidth(line.text, fs);
    textEls.push(
      `<text x="${TEXT_X}" y="${line.y}" font-family="msyh,'Microsoft YaHei','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif" font-size="${fs}" font-weight="700" fill="${color}">${escapeXml(line.text)}</text>`
    );
    textEls.push(
      `<line x1="${TEXT_X}" y1="${lineY}" x2="${TEXT_X + lineW}" y2="${lineY}" stroke="${color}" stroke-width="${lineH}" stroke-linecap="round" opacity="0.85"/>`
    );
  });

  const fontFace = base
    ? `<style>@font-face{font-family:'msyh';src:url('${base}/msyh.ttf') format('truetype');font-display:swap;}</style>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="geometricPrecision" text-rendering="optimizeLegibility">
  <title>IP 签名档</title>
  <defs>
    ${fontFace}
    <clipPath id="cardClip">
      <rect x="0" y="0" width="${W}" height="${H}"/>
    </clipPath>
  </defs>
  <image href="${base}/bg.jpg" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <g clip-path="url(#cardClip)">
    <image href="${base}/kbn.png" x="${mascotX}" y="${mascotY}" width="${mascotW}" height="${mascotH}" preserveAspectRatio="xMidYMax meet"/>
  </g>
  ${textEls.join("\n    ")}
</svg>`;

  return svg;
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateHTML(info, svg) {
  function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }
  function codeBlock(raw, template) {
    const htmlSafe = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<div class="code-block" data-tpl="${escapeAttr(template)}"><code>${htmlSafe}</code><button type="button" class="copy-btn" data-copy="${escapeAttr(raw)}" title="复制代码">📋 复制</button></div>`;
  }
  const baseUrl = info.baseUrl || "";
  const DEFAULT_FMT = "jpg";
  const endpointOf = function (fmt) {
    if (fmt === "svg") return "/svg";
    if (fmt === "png") return "/png";
    return "/jpg";
  };
  // 占位符 {EP} = endpoint (relative), {EP_FULL} = absolute URL, {SUFFIX} = ?s= 占位
  const tpl = function (fmt) {
    const ep = endpointOf(fmt);
    const full = baseUrl + ep;
    const html = {
      basic: `<img src="${full}" alt="IP签名档" />`,
      custom: `<img src="${full}?s=自定义文字" alt="IP签名档" />`,
    };
    const md = {
      basic: `![IP签名档](${full})`,
      custom: `![IP签名档](${full}?s=自定义文字)`,
    };
    const bb = {
      basic: `[img]${full}[/img]`,
      custom: `[img]${full}?s=自定义文字[/img]`,
    };
    const link = {
      basic: `${full}`,
      custom: `${full}?s=自定义文字`,
    };
    return { html, md, bb, link, endpoint: ep };
  };
  const initTpl = tpl(DEFAULT_FMT);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <title>IP 签名档 - 您的网络信息</title>
  <style>
    @font-face {
      font-family: 'msyh';
      src: url('/msyh.ttf') format('truetype');
    }
    :root {
      --bg-gradient-start: #667eea;
      --bg-gradient-end: #764ba2;
      --card-bg: #ffffff;
      --card-shadow: rgba(0, 0, 0, 0.3);
      --text-primary: #333333;
      --text-secondary: #555555;
      --text-muted: #666666;
      --text-highlight: #e60012;
      --info-bg: #f8f9fa;
      --info-border: #e60012;
      --divider: #eeeeee;
      --usage-bg: #f0f4ff;
      --code-bg: #2d2d2d;
      --code-text: #f8f8f2;
      --footer-text: #ffffff;
      --switch-bg: rgba(255, 255, 255, 0.7);
      --switch-border: rgba(102, 126, 234, 0.18);
      --switch-ink: #475569;
      --switch-slider: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      --switch-shadow: 0 4px 12px rgba(102, 126, 234, 0.35);
    }
    [data-theme="dark"] {
      --bg-gradient-start: #1a1a2e;
      --bg-gradient-end: #16213e;
      --card-bg: #1f2937;
      --card-shadow: rgba(0, 0, 0, 0.5);
      --text-primary: #e5e7eb;
      --text-secondary: #cbd5e1;
      --text-muted: #9ca3af;
      --text-highlight: #ff6b6b;
      --info-bg: #374151;
      --info-border: #ff6b6b;
      --divider: #374151;
      --usage-bg: #1e3a5f;
      --code-bg: #111827;
      --code-text: #e5e7eb;
      --footer-text: #e5e7eb;
      --switch-bg: rgba(17, 24, 39, 0.85);
      --switch-border: rgba(255, 255, 255, 0.1);
      --switch-ink: #cbd5e1;
      --switch-slider: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      --switch-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'msyh', "Microsoft YaHei", sans-serif;
      background: linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--bg-gradient-end) 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      transition: background 0.3s ease;
    }
    .container {
      max-width: 640px;
      width: 100%;
      position: relative;
    }
    .theme-toggle {
      position: absolute;
      top: 0;
      right: 0;
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      z-index: 10;
    }
    .theme-toggle:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: scale(1.08);
    }
    [data-theme="dark"] .theme-toggle {
      background: rgba(255, 255, 255, 0.1);
    }
    [data-theme="dark"] .theme-toggle:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .header {
      text-align: center;
      color: white;
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .header p {
      font-size: 14px;
      opacity: 0.85;
    }
    .card {
      background: var(--card-bg);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 20px 60px var(--card-shadow);
      transition: background 0.3s ease, box-shadow 0.3s ease;
    }
    .info-list {
      list-style: none;
      display: grid;
      gap: 12px;
    }
    .info-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      background: var(--info-bg);
      border-radius: 10px;
      border-left: 4px solid var(--info-border);
      transition: background 0.3s ease, border-color 0.3s ease;
    }
    .info-label {
      font-weight: 700;
      color: var(--text-muted);
      min-width: 90px;
      font-size: 13px;
      transition: color 0.3s ease;
    }
    .info-value {
      color: var(--text-primary);
      font-size: 14px;
      word-break: break-all;
      flex: 1;
      transition: color 0.3s ease;
    }
    .info-value.highlight {
      color: var(--text-highlight);
      font-weight: 600;
      transition: color 0.3s ease;
    }
    .preview {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid var(--divider);
      transition: border-color 0.3s ease;
    }
    .preview-title {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 12px;
      text-align: center;
      transition: color 0.3s ease;
    }
    .preview svg {
      display: block;
      margin: 0 auto;
      max-width: 100%;
      height: auto;
    }
    .usage {
      margin-top: 20px;
      padding: 16px;
      background: var(--usage-bg);
      border-radius: 10px;
      font-size: 12px;
      color: var(--text-secondary);
      transition: background 0.3s ease, color 0.3s ease;
    }
    .usage h3 {
      color: var(--text-primary);
      margin-bottom: 8px;
      font-size: 14px;
      transition: color 0.3s ease;
    }
    .usage h4 {
      color: var(--text-secondary);
      margin: 14px 0 6px 0;
      font-size: 13px;
      font-weight: 600;
      transition: color 0.3s ease;
    }
    .usage p {
      transition: color 0.3s ease;
    }
    .usage code {
      display: block;
      background: var(--code-bg);
      color: var(--code-text);
      padding: 10px 14px;
      border-radius: 6px;
      font-family: "Consolas", "Monaco", monospace;
      font-size: 12px;
      margin: 0;
      word-break: break-all;
      transition: background 0.3s ease, color 0.3s ease;
      flex: 1;
      white-space: pre-wrap;
    }
    .code-block {
      display: flex;
      align-items: stretch;
      gap: 8px;
      margin: 8px 0;
      background: var(--code-bg);
      border-radius: 6px;
      overflow: hidden;
      transition: background 0.3s ease;
    }
    .copy-btn {
      flex-shrink: 0;
      min-width: 56px;
      border: none;
      background: rgba(255, 255, 255, 0.08);
      color: var(--code-text);
      font-family: 'msyh', "Microsoft YaHei", sans-serif;
      font-size: 12px;
      cursor: pointer;
      padding: 0 12px;
      transition: background 0.2s ease, color 0.2s ease;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .copy-btn:hover {
      background: rgba(255, 255, 255, 0.18);
    }
    .copy-btn.copied {
      background: rgba(72, 187, 120, 0.35);
      color: #86efac;
    }
    [data-theme="dark"] .copy-btn.copied {
      background: rgba(72, 187, 120, 0.25);
    }
    .format-switch {
      display: inline-flex;
      align-items: center;
      position: relative;
      background: var(--switch-bg);
      border-radius: 999px;
      padding: 4px;
      gap: 2px;
      margin-left: 12px;
      vertical-align: middle;
      border: 1px solid var(--switch-border);
      transition: background 0.3s ease, border-color 0.3s ease;
    }
    .format-switch button {
      position: relative;
      z-index: 1;
      border: none;
      background: transparent;
      color: var(--switch-ink);
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 999px;
      cursor: pointer;
      transition: color 0.25s ease;
    }
    .format-switch button.is-active {
      color: #fff;
    }
    .format-switch .slider {
      position: absolute;
      top: 4px;
      left: 4px;
      height: calc(100% - 8px);
      width: 60px;
      background: var(--switch-slider);
      border-radius: 999px;
      box-shadow: var(--switch-shadow);
      transition: transform 0.35s cubic-bezier(0.4, 0.0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0.0, 0.2, 1);
      z-index: 0;
    }
    .usage-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .usage-header h3 {
      margin: 0;
    }
    .format-hint {
      color: var(--text-muted);
      font-size: 11px;
      flex-basis: 100%;
      text-align: center;
    }
    .footer {
      text-align: center;
      color: var(--footer-text);
      margin-top: 20px;
      font-size: 12px;
      opacity: 0.7;
      transition: color 0.3s ease;
    }
  </style>
</head>
<body>
  <div class="container">
    <button id="themeToggle" class="theme-toggle" aria-label="切换主题" title="切换主题">🌙</button>
    <div class="header">
      <h1>🌐 您的网络信息</h1>
      <p>基于 Cloudflare Workers 的 IP 签名档服务</p>
    </div>
    <div class="card">
      <ul class="info-list">
        <li class="info-item">
          <span class="info-label">📍 地区</span>
          <span class="info-value highlight">${info.location}</span>
        </li>
        <li class="info-item">
          <span class="info-label">📅 日期</span>
          <span class="info-value">${info.dateStr} ${info.weekStr}</span>
        </li>
        <li class="info-item">
          <span class="info-label">🌍 IP地址</span>
          <span class="info-value highlight">${info.ip}</span>
        </li>
        ${
          info.weather
            ? `<li class="info-item">
          <span class="info-label">☁️ 天气</span>
          <span class="info-value">${info.weather.text}</span>
        </li>`
            : ""
        }
        <li class="info-item">
          <span class="info-label">💻 操作系统</span>
          <span class="info-value">${info.os}</span>
        </li>
        <li class="info-item">
          <span class="info-label">🖥️ 浏览器</span>
          <span class="info-value">${info.browser}</span>
        </li>
      </ul>
      <div class="preview">
        <p class="preview-title">📋 签名档预览</p>
        ${svg}
      </div>
      <div class="usage">
        <div class="usage-header">
          <h3>📝 使用方法</h3>
          <div class="format-switch" role="tablist" aria-label="端点格式切换">
            <span class="slider" aria-hidden="true"></span>
            <button type="button" class="format-btn" data-fmt="svg" role="tab" aria-selected="false">SVG</button>
            <button type="button" class="format-btn is-active" data-fmt="jpg" role="tab" aria-selected="true">JPG</button>
            <button type="button" class="format-btn" data-fmt="png" role="tab" aria-selected="false">PNG</button>
          </div>
          <span class="format-hint" data-format-hint>默认：JPG · GitHub README 推荐使用</span>
        </div>
        <h4>🌐 HTML（网站 / 博客 / 支持 HTML 的论坛）</h4>
        <p>基础签名档：</p>
        ${codeBlock(initTpl.html.basic, "html.basic")}
        <p>带自定义文字（可选）：</p>
        ${codeBlock(initTpl.html.custom, "html.custom")}

        <h4>📋 Markdown（GitHub / README / 支持 Markdown 的平台）</h4>
        <p>基础签名档：</p>
        ${codeBlock(initTpl.md.basic, "md.basic")}
        <p>带自定义文字（可选）：</p>
        ${codeBlock(initTpl.md.custom, "md.custom")}

        <h4>🏷️ BBCode / UBB（传统论坛如 Discuz!、phpBB 等）</h4>
        <p>基础签名档：</p>
        ${codeBlock(initTpl.bb.basic, "bb.basic")}
        <p>带自定义文字（可选）：</p>
        ${codeBlock(initTpl.bb.custom, "bb.custom")}

        <h4>🔗 直接链接（复制粘贴即可）</h4>
        <p>基础签名档：</p>
        ${codeBlock(initTpl.link.basic, "link.basic")}
        <p>带自定义文字（可选）：</p>
        ${codeBlock(initTpl.link.custom, "link.custom")}
      </div>
    </div>
    <p class="footer">Powered by Cloudflare Workers ☁️</p>
  </div>
  <script>
    (function () {
      var STORAGE_KEY = 'ip-info-theme';
      var btn = document.getElementById('themeToggle');
      var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        if (btn) {
          btn.textContent = theme === 'dark' ? '☀️' : '🌙';
          btn.setAttribute('aria-label', theme === 'dark' ? '切换至亮色模式' : '切换至暗色模式');
          btn.setAttribute('title', theme === 'dark' ? '切换至亮色模式' : '切换至暗色模式');
        }
      }

      function getInitialTheme() {
        var saved = null;
        try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
        if (saved === 'light' || saved === 'dark') return saved;
        return systemDark.matches ? 'dark' : 'light';
      }

      var currentTheme = getInitialTheme();
      applyTheme(currentTheme);

      if (btn) {
        btn.addEventListener('click', function () {
          currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
          applyTheme(currentTheme);
          try { localStorage.setItem(STORAGE_KEY, currentTheme); } catch (_) {}
        });
      }

      if (typeof systemDark.addEventListener === 'function') {
        systemDark.addEventListener('change', function (e) {
          var saved = null;
          try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
          if (saved !== 'light' && saved !== 'dark') {
            currentTheme = e.matches ? 'dark' : 'light';
            applyTheme(currentTheme);
          }
        });
      } else if (typeof systemDark.addListener === 'function') {
        systemDark.addListener(function (e) {
          var saved = null;
          try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
          if (saved !== 'light' && saved !== 'dark') {
            currentTheme = e.matches ? 'dark' : 'light';
            applyTheme(currentTheme);
          }
        });
      }
    })();

    (function () {
      function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
        document.body.removeChild(ta);
        return ok;
      }
      function copyText(text, btn) {
        var done = false;
        var onDone = function (ok) {
          if (done) return;
          done = true;
          if (ok) {
            var original = btn.innerHTML;
            btn.classList.add('copied');
            btn.innerHTML = '✓ 已复制';
            setTimeout(function () {
              btn.classList.remove('copied');
              btn.innerHTML = original;
            }, 1500);
          } else {
            btn.title = '复制失败，请手动选择复制';
          }
        };
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          try {
            Promise.resolve(navigator.clipboard.writeText(text))
              .then(function () { onDone(true); })
              .catch(function () { onDone(fallbackCopy(text)); });
            return;
          } catch (_) { /* fallthrough */ }
        }
        onDone(fallbackCopy(text));
      }
      document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.copy-btn');
        if (!btn) return;
        e.preventDefault();
        var text = btn.getAttribute('data-copy') || '';
        copyText(text, btn);
      });
    })();

    (function () {
      var BASE_URL = ${JSON.stringify(baseUrl)};
      var DEFAULT_FMT = ${JSON.stringify(DEFAULT_FMT)};
      var FMT_HINTS = {
        svg: '矢量 · 论坛/博客内嵌首选（部分平台可能无法显示中文）',
        jpg: '位图 · 体积小，GitHub README / camo 代理首选',
        png: '位图 · 无损高清，需透明背景时使用',
      };
      function endpointOf(fmt) {
        if (fmt === 'svg') return '/svg';
        if (fmt === 'png') return '/png';
        return '/jpg';
      }
      function templatesFor(fmt) {
        var full = BASE_URL + endpointOf(fmt);
        return {
          html: {
            basic: '<img src="' + full + '" alt="IP签名档" />',
            custom: '<img src="' + full + '?s=自定义文字" alt="IP签名档" />',
          },
          md: {
            basic: '![IP签名档](' + full + ')',
            custom: '![IP签名档](' + full + '?s=自定义文字)',
          },
          bb: {
            basic: '[img]' + full + '[/img]',
            custom: '[img]' + full + '?s=自定义文字[/img]',
          },
          link: {
            basic: full,
            custom: full + '?s=自定义文字',
          },
        };
      }
      function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      function resolveTpl(kind, custom, fmt) {
        var t = templatesFor(fmt);
        var keys = kind.split('.');
        var group = t[keys[0]] || {};
        return group[keys[1]] || '';
      }
      var hintEl = document.querySelector('[data-format-hint]');
      var switchEl = document.querySelector('.format-switch');
      var sliderEl = switchEl ? switchEl.querySelector('.slider') : null;
      var btns = switchEl ? Array.prototype.slice.call(switchEl.querySelectorAll('.format-btn')) : [];
      var codeBlocks = document.querySelectorAll('.code-block[data-tpl]');

      function positionSlider(activeBtn) {
        if (!sliderEl || !activeBtn) return;
        var containerRect = switchEl.getBoundingClientRect();
        var btnRect = activeBtn.getBoundingClientRect();
        var offsetX = btnRect.left - containerRect.left - 4; // 4 = switch padding left
        sliderEl.style.width = btnRect.width + 'px';
        sliderEl.style.transform = 'translateX(' + offsetX + 'px)';
      }
      function updateCodeBlocks(fmt) {
        for (var i = 0; i < codeBlocks.length; i++) {
          var block = codeBlocks[i];
          var tpl = block.getAttribute('data-tpl') || '';
          var custom = /\.custom$/.test(tpl);
          var kind = tpl.replace(/\.(basic|custom)$/, '') + (custom ? '.custom' : '.basic');
          var text = resolveTpl(kind, custom, fmt);
          var codeEl = block.querySelector('code');
          var copyBtn = block.querySelector('.copy-btn');
          if (codeEl) codeEl.textContent = text;
          if (copyBtn) {
            copyBtn.setAttribute('data-copy', text);
            copyBtn.classList.remove('copied');
            copyBtn.innerHTML = '📋 复制';
          }
        }
      }
      function activate(fmt) {
        for (var i = 0; i < btns.length; i++) {
          var b = btns[i];
          var isActive = b.getAttribute('data-fmt') === fmt;
          b.classList.toggle('is-active', isActive);
          b.setAttribute('aria-selected', isActive ? 'true' : 'false');
          if (isActive) positionSlider(b);
        }
        if (hintEl) hintEl.textContent = (fmt === DEFAULT_FMT ? '默认：' : '') + (fmt.toUpperCase()) + ' · ' + (FMT_HINTS[fmt] || '');
        updateCodeBlocks(fmt);
      }
      for (var j = 0; j < btns.length; j++) {
        btns[j].addEventListener('click', function (e) {
          var fmt = e.currentTarget.getAttribute('data-fmt');
          if (!fmt) return;
          try { localStorage.setItem('ip-info-format', fmt); } catch (_) {}
          activate(fmt);
        });
      }
      function initFormat() {
        var saved = null;
        try { saved = localStorage.getItem('ip-info-format'); } catch (_) {}
        var fmt = (saved === 'svg' || saved === 'jpg' || saved === 'png') ? saved : DEFAULT_FMT;
        activate(fmt);
      }
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initFormat, 0);
      } else {
        window.addEventListener('DOMContentLoaded', initFormat);
      }
      window.addEventListener('resize', function () {
        var activeBtn = switchEl ? switchEl.querySelector('.format-btn.is-active') : null;
        positionSlider(activeBtn);
      });
    })();
  </script>
</body>
</html>`;
}