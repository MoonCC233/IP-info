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

  const mascotX = 300;
  const mascotY = -4;
  const mascotW = 230;
  const mascotH = 260;

  // 使用 <text> 替代 <foreignObject>，确保在 <img> 上下文中也能渲染
  const textEls = textLines.map((line) => {
    const fs = line.small ? FONT_SIZE_SMALL : FONT_SIZE;
    const color = line.small ? "#6b4a35" : "#5a3825";
    return `<text x="${TEXT_X}" y="${line.y}" font-family="'Microsoft YaHei','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif" font-size="${fs}" font-weight="bold" fill="${color}" text-decoration="underline">${escapeXml(line.text)}</text>`;
  });

  const fontFace = base
    ? `<style type="text/css">@font-face{font-family:'msyh';src:url('${base}/msyh.ttf') format('truetype');}</style>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
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
  function codeBlock(raw) {
    const htmlSafe = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const attrSafe = raw
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");
    return `<div class="code-block"><code>${htmlSafe}</code><button type="button" class="copy-btn" data-copy="${attrSafe}" title="复制代码">📋 复制</button></div>`;
  }
  const baseUrl = info.baseUrl || "";
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
        <h3>📝 使用方法</h3>
        <h4>🌐 HTML（网站 / 博客 / 支持 HTML 的论坛）</h4>
        <p>基础签名档：</p>
        ${codeBlock(`<img src="${baseUrl}/svg" alt="IP签名档" />`)}
        <p>带自定义文字（可选）：</p>
        ${codeBlock(`<img src="${baseUrl}/svg?s=自定义文字" alt="IP签名档" />`)}

        <h4>📋 Markdown（GitHub / README / 支持 Markdown 的平台）</h4>
        <p>基础签名档：</p>
        ${codeBlock(`![IP签名档](${baseUrl}/svg)`)}
        <p>带自定义文字（可选）：</p>
        ${codeBlock(`![IP签名档](${baseUrl}/svg?s=自定义文字)`)}

        <h4>🏷️ BBCode / UBB（传统论坛如 Discuz!、phpBB 等）</h4>
        <p>基础签名档：</p>
        ${codeBlock(`[img]${baseUrl}/svg[/img]`)}
        <p>带自定义文字（可选）：</p>
        ${codeBlock(`[img]${baseUrl}/svg?s=自定义文字[/img]`)}

        <h4>🔗 直接链接（复制粘贴即可）</h4>
        <p>基础签名档：</p>
        ${codeBlock(`${baseUrl}/svg`)}
        <p>带自定义文字（可选）：</p>
        ${codeBlock(`${baseUrl}/svg?s=自定义文字`)}
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
  </script>
</body>
</html>`;
}