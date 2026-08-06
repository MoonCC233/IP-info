import { parseUA } from "./ua-parser.js";
import { getWeather } from "./weather.js";

const WEEK_MAP = ["日", "一", "二", "三", "四", "五", "六"];

export async function generateInfo(request) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  const ua = request.headers.get("user-agent") || "";
  const { os, browser } = parseUA(ua);

  const cf = request.cf || {};
  const country = cf.country || "";
  const region = cf.region || cf.regionCode || "";
  const city = cf.city || "";

  const locationParts = [country, region, city].filter(Boolean);
  const location = locationParts.length > 0 ? locationParts.join("-") : "未知地区";

  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const weekStr = `星期${WEEK_MAP[now.getDay()]}`;

  const weather = await getWeather(cf.latitude, cf.longitude);

  return {
    ip,
    maskedIp: maskIp(ip),
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

function maskIp(ip) {
  if (!ip) return "";
  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.${parts[3]}`;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":");
    if (parts.length >= 2) {
      parts[1] = "****";
      return parts.slice(0, 3).join(":");
    }
  }
  return ip;
}

export function generateSVG(info, queryText = "") {
  const width = 550;
  const height = 230;

  const lines = [];

  lines.push({
    text: `欢迎您来自${info.location}的朋友`,
    y: 42,
  });
  lines.push({
    text: `今天是${info.dateStr} ${info.weekStr}`,
    y: 74,
  });

  let ipLine = `您的IP是:${info.maskedIp || info.ip}`;
  if (info.weather) {
    ipLine += `  ${info.weather.text}`;
  }
  lines.push({ text: ipLine, y: 108 });

  lines.push({
    text: `您使用的是${info.os}操作系统`,
    y: 144,
  });
  lines.push({
    text: `您使用的是${info.browser}`,
    y: 179,
  });

  if (queryText) {
    lines.push({ text: queryText, y: 208, small: true });
  }

  const svgLines = lines.map((line, i) => {
    const fontSize = line.small ? 14 : 18;
    const fill = i >= 5 || line.small ? "#333333" : "#e60012";
    return `<text x="18" y="${line.y}" font-family="msyh, Microsoft YaHei, 微软雅黑, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${fill}">${escapeXml(line.text)}</text>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style type="text/css">
      @font-face {
        font-family: 'msyh';
        src: url('/msyh.ttf') format('truetype');
      }
    </style>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#fff5f5;stop-opacity:1" />
      <stop offset="50%" style="stop-color:#ffe8e8;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#ffd4d4;stop-opacity:1" />
    </linearGradient>
    <filter id="shadow" x="-2%" y="-2%" width="104%" height="104%">
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#00000022" />
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="#e60012" stroke-width="2" rx="4" ry="4" />
  <g filter="url(#shadow)">
    ${svgLines.join("\n    ")}
  </g>
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
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IP 签名档 - 您的网络信息</title>
  <style>
    @font-face {
      font-family: 'msyh';
      src: url('/msyh.ttf') format('truetype');
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'msyh', "Microsoft YaHei", "微软雅黑", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      max-width: 640px;
      width: 100%;
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
      background: white;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
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
      background: #f8f9fa;
      border-radius: 10px;
      border-left: 4px solid #e60012;
    }
    .info-label {
      font-weight: 700;
      color: #666;
      min-width: 90px;
      font-size: 13px;
    }
    .info-value {
      color: #333;
      font-size: 14px;
      word-break: break-all;
      flex: 1;
    }
    .info-value.highlight {
      color: #e60012;
      font-weight: 600;
    }
    .preview {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .preview-title {
      font-size: 14px;
      color: #666;
      margin-bottom: 12px;
      text-align: center;
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
      background: #f0f4ff;
      border-radius: 10px;
      font-size: 12px;
      color: #555;
    }
    .usage h3 {
      color: #333;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .usage code {
      display: block;
      background: #2d2d2d;
      color: #f8f8f2;
      padding: 10px 14px;
      border-radius: 6px;
      font-family: "Consolas", "Monaco", monospace;
      font-size: 12px;
      margin: 8px 0;
      word-break: break-all;
    }
    .footer {
      text-align: center;
      color: white;
      margin-top: 20px;
      font-size: 12px;
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="container">
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
          <span class="info-value highlight">${info.maskedIp || info.ip}</span>
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
        <p>在论坛或支持 HTML 的平台中，使用以下代码引用您的签名档：</p>
        <code>&lt;img src="${info.baseUrl || ""}/svg" alt="IP签名档" /&gt;</code>
        <p>带有文字参数（可选）：</p>
        <code>&lt;img src="${info.baseUrl || ""}/svg?s=自定义文字" alt="IP签名档" /&gt;</code>
      </div>
    </div>

    <p class="footer">Powered by Cloudflare Workers ☁️</p>
  </div>
</body>
</html>`;
}