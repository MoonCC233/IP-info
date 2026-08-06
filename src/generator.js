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

  const textLines = [];

  textLines.push({ text: `欢迎您来自${info.location}的朋友`, y: 35 });
  textLines.push({ text: `今天是${info.dateStr} ${info.weekStr}`, y: 72 });

  let ipLine = `您的IP是:${info.ip}`;
  if (info.weather) {
    ipLine += `  ${info.weather.text}`;
  }
  textLines.push({ text: ipLine, y: 110 });

  textLines.push({ text: `您使用的是${info.os}操作系统`, y: 148 });
  textLines.push({ text: `您使用的是${info.browser}`, y: 186 });

  if (queryText) {
    textLines.push({ text: queryText, y: 220, small: true });
  }

  const TEXT_X = 20;

  const textEls = textLines.map((line) => {
    const fontSize = line.small ? 15 : 17;
    const fill = line.small ? "#6b4a35" : "#5a3825";
    return `<text x="${TEXT_X}" y="${line.y}" font-family="msyh, Microsoft YaHei, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${fill}">${escapeXml(line.text)}</text>`;
  });

  function measureTextWidth(text, fontSize) {
    let width = 0;
    for (const ch of text) {
      if (/[\u4e00-\u9fff]/.test(ch)) {
        width += fontSize;
      } else if (/\s/.test(ch)) {
        width += fontSize * 0.3;
      } else {
        width += fontSize * 0.6;
      }
    }
    return width;
  }

  const underlineEls = textLines.map((line) => {
    const fontSize = line.small ? 15 : 17;
    const textWidth = measureTextWidth(line.text, fontSize);
    const ulY = line.y + 4;
    return `<line x1="${TEXT_X}" y1="${ulY}" x2="${TEXT_X + textWidth}" y2="${ulY}" stroke="#5a3825" stroke-width="1.5"/>`;
  });

  const mascotX = 300;
  const mascotY = -4;
  const mascotW = 230;
  const mascotH = 260;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style type="text/css">
      @font-face {
        font-family: 'msyh';
        src: url('/msyh.ttf') format('truetype');
      }
    </style>
    <clipPath id="cardClip">
      <rect x="0" y="0" width="${W}" height="${H}"/>
    </clipPath>
  </defs>
  <image href="/bg.jpg" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
  <g clip-path="url(#cardClip)">
    <image href="/kbn.png" x="${mascotX}" y="${mascotY}" width="${mascotW}" height="${mascotH}" preserveAspectRatio="xMidYMax meet"/>
  </g>
  <g>
    ${underlineEls.join("\n    ")}
    ${textEls.join("\n    ")}
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
      font-family: 'msyh', "Microsoft YaHei", sans-serif;
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