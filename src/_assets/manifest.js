// 此文件由 scripts/generate_modules.js 自动生成，请勿手动修改。
// src/_assets/*.{ttf,jpg,png,ico} 通过 wrangler module rules 声明为 Data 类型，
// import 得到 Uint8Array，不计入 Worker script 大小限制。
// 生成时间：2026-08-14T02:54:14.015Z

import A_BG_JPG from "./bg.jpg?data";
import A_FAVICON_ICO from "./favicon.ico?data";

const MAP = {
  "/bg.jpg": A_BG_JPG,
  "/favicon.ico": A_FAVICON_ICO,
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
