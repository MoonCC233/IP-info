# IP 签名档 · Cloudflare Workers 版

基于 Cloudflare Workers 的动态 IP 签名档服务，展示访问者的 IP 地址（脱敏）、地理位置、日期、天气、操作系统和浏览器信息。无需服务器，全球边缘网络加速，零运维。

## 功能特性

- **IP 地址** — 通过 Cloudflare 边缘网络获取真实访客 IP（脱敏展示）
- **地理位置** — 使用 Cloudflare 内置 `request.cf` 数据，无需第三方 IP 库
- **日期星期** — 自动显示当前日期和星期
- **天气信息** — 基于 [Open-Meteo](https://open-meteo.com/) 免费 API，无需密钥
- **操作系统识别** — 支持 Windows / macOS / iOS / Android / Linux / HarmonyOS
- **浏览器识别** — 支持 Chrome / Firefox / Safari / Edge / Opera / 微信 / QQ 等
- **SVG 签名档** — 矢量格式，可缩放、轻量，可直接用 `<img>` 引用
- **JSON API** — 提供结构化数据接口，方便二次开发

## 项目结构

```
ip-info/
├── .github/
│   └── workflows/
│       └── deploy.yml   # GitHub Actions 自动部署
├── public/
│   └── msyh.ttf         # 微软雅黑字体（静态资源）
├── src/
│   ├── index.js        # Worker 入口，路由与请求处理
│   ├── generator.js     # 信息采集与 SVG / HTML 生成
│   ├── ua-parser.js     # User-Agent 解析（操作系统 + 浏览器）
│   └── weather.js       # 天气获取（Open-Meteo API）
├── wrangler.jsonc       # Wrangler 配置
├── package.json         # 项目依赖与脚本
└── .gitignore
```

## 快速开始

### 前置要求

- Node.js 18+
- npm 10+

### 安装与本地开发

```bash
npm install
npm run dev
```

本地服务启动后访问 `http://localhost:8787` 即可查看效果。

### 部署到 Cloudflare

```bash
# 首次使用需登录
npx wrangler login

# 部署到全球边缘网络
npm run deploy
```

部署成功后会得到一个 `https://ip-info.<你的子域>.workers.dev` 的地址。

### 自动部署（GitHub Actions）

项目已配置 GitHub Actions 自动部署工作流。推送到 `main` 或 `master` 分支时自动触发部署。

**配置步骤：**

1. 在 GitHub 仓库中进入 **Settings → Secrets and variables → Actions**
2. 添加 Repository secret：
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: 你的 Cloudflare API Token

**获取 API Token：**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. 点击 **Create Token**
3. 使用 **Edit Cloudflare Workers** 模板
4. 复制生成的 Token（仅显示一次）

配置完成后，每次推送代码将自动部署到 Cloudflare Workers。

## 使用方法

### 端点说明

| 端点 | 说明 |
|------|------|
| `GET /` | 完整 HTML 页面，展示所有信息 + 签名档预览 |
| `GET /svg` | SVG 签名档图片，可直接用 `<img>` 引用 |
| `GET /svg?s=自定义文字` | 带自定义文字的签名档 |
| `GET /api/info` | JSON 接口，返回所有结构化数据 |
| `GET /health` | 健康检查 |

### 在论坛 / 博客中引用签名档

```html
<!-- 基础签名档 -->
<img src="https://ip-info.<你的子域>.workers.dev/svg" alt="IP签名档" />

<!-- 带自定义文字 -->
<img src="https://ip-info.<你的子域>.workers.dev/svg?s=欢迎光临" alt="IP签名档" />
```

### JSON API 示例

```bash
curl https://ip-info.<你的子域>.workers.dev/api/info
```

```json
{
  "ip": "203.0.113.42",
  "maskedIp": "203.0.*.42",
  "location": "CN-Sichuan-Dazhou",
  "country": "CN",
  "region": "Sichuan",
  "city": "Dazhou",
  "os": "Windows 10/11",
  "browser": "Chrome(120.0.0.0)",
  "date": "2026年8月6日",
  "week": "星期四",
  "weather": {
    "temperature": 32,
    "description": "晴",
    "text": "晴 32℃"
  },
  "timestamp": "2026-08-06T08:41:54.970Z"
}
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers |
| 图片格式 | SVG（矢量，支持中文字体） |
| IP / 地理定位 | Cloudflare `request.cf` 内置数据 |
| 天气数据 | Open-Meteo 免费 API |
| UA 解析 | 自研轻量正则解析器 |
| 配置 | Wrangler + `wrangler.jsonc` |

## 与原 PHP 版本的区别

本项目由原 PHP + GD 库版本迁移而来，主要改进：

| 特性 | 原 PHP 版本 | Workers 版本 |
|------|------------|-------------|
| 运行环境 | PHP + GD 库 + 服务器 | Cloudflare Workers（无服务器） |
| 地理定位 | 外部 API 网络请求 | 内置 `request.cf`（零延迟） |
| 图片格式 | JPEG（位图） | SVG（矢量，可缩放） |
| 全球加速 | 取决于服务器位置 | Cloudflare 全球 300+ 边缘节点 |
| 扩展性 | 受限于服务器资源 | 自动扩展，零运维 |

## License

MIT
