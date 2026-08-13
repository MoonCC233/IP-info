// Node 脚本：将 public/ 下的静态资源复制到 src/_assets/，以便 wrangler module rules 识别为 Data 模块
// Data modules 不计入 Worker script 大小限制（免费版 ≤1 MiB gzip 对 JS），是线上唯一可行方案
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, basename, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "public");
const DST_DIR = join(ROOT, "src", "_assets");
const MANIFEST = join(DST_DIR, "manifest.js");

const WANTED_EXTS = new Set([".jpg", ".jpeg", ".png", ".ttf", ".ico"]);
// 只内嵌小文件作为 fallback：bg.jpg / favicon.ico
// 大文件（kbn.png 2.5 MB / msyh.ttf 1.9 MB）不内嵌，运行时从 Assets binding 或
// HTTP fallback（public/ 下的 static assets）拿，不计入 Worker script size 限制。
const WANTED_FILES = new Set(["bg.jpg", "favicon.ico"]);

if (!existsSync(SRC)) {
  console.error("[assets-modules] public/ 不存在：", SRC);
  process.exit(1);
}
mkdirSync(DST_DIR, { recursive: true });

const copied = [];
for (const name of readdirSync(SRC)) {
  const srcPath = join(SRC, name);
  const st = statSync(srcPath);
  if (!st.isFile()) continue;
  if (!WANTED_EXTS.has(extname(name).toLowerCase())) continue;
  if (WANTED_FILES && !WANTED_FILES.has(name)) continue;
  const dstPath = join(DST_DIR, name);
  copyFileSync(srcPath, dstPath);
  copied.push({ name, size: st.size });
  console.log(
    `[assets-modules] ${name.padEnd(12)} size=${(st.size/1024).toFixed(1)}KB  -> src/_assets/${name}`
  );
}

// 生成 manifest.js：列出所有嵌入的资源路径，并为每个资源动态 import
// 注意：不能直接 import 字符串路径，必须写静态 import 语句让 bundler/rules 命中
const toIdent = (n) =>
  "A_" + n.replace(/[^A-Za-z0-9]/g, "_").replace(/^_+/, "").toUpperCase();
const imports = copied.map((c) => `import ${toIdent(c.name)} from "./${c.name}";`).join("\n");
const map = copied.map((c) => `  "/${c.name}": ${toIdent(c.name)},`).join("\n");
const manifest = `// 此文件由 scripts/generate_modules.js 自动生成，请勿手动修改。
// src/_assets/*.{ttf,jpg,png,ico} 通过 wrangler module rules 声明为 Data 类型，
// import 得到 Uint8Array，不计入 Worker script 大小限制。
// 生成时间：${new Date().toISOString()}

${imports}

const MAP = {
${map}
};

export function assetBytesByModule(relPath) {
  if (!relPath) return null;
  const key = relPath.startsWith("/") ? relPath : "/" + relPath;
  const v = MAP[key];
  if (!v) return null;
  // wrangler Data module import 本身就是 Uint8Array
  return v && typeof v === "object" && v.constructor && v.constructor.name === "Uint8Array" ? v : new Uint8Array(v);
}

export function embeddedAssetList() {
  return Object.keys(MAP);
}
`;
writeFileSync(MANIFEST, manifest, "utf8");
console.log(
  `[assets-modules] manifest -> src/_assets/manifest.js (${copied.length} files, total ${(copied.reduce((s,c)=>s+c.size,0)/1024/1024).toFixed(2)} MB)`
);
