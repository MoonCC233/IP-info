import { assetBytesByModule } from "./_assets/manifest.js";

// 取 env 上所有可能作为候选 binding 的 key（含 ASSET/STATIC 名称 或 有 fetch 方法）

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

  // 优先级 2：Assets binding（env.ASSETS，由 wrangler.jsonc assets.binding 注入）
  const assetBinding = env && env.ASSETS;
  if (assetBinding && typeof assetBinding.fetch === "function") {
    // ASSETS binding 只看 URL pathname，用 fake origin 即可
    const fakeUrl = `https://assets.local/${cleanRel}`;
    for (const attempt of [
      () => assetBinding.fetch(new Request(fakeUrl)),
      () => assetBinding.fetch(fakeUrl),
      () => assetBinding.fetch(new Request(`/${cleanRel}`)),
    ]) {
      try {
        const r = await attempt();
        if (r && r.ok) return new Uint8Array(await r.arrayBuffer());
      } catch (_) { /* 继续尝试 */ }
    }
  }

  if (!allowHttpFallback) {
    throw new Error(`Assets binding 未找到 (env.ASSETS=${assetBinding ? "present" : "absent"})，已跳过 HTTP fallback 防递归`);
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
    err.message = (err && err.message ? err.message : String(err)) + ` (env.ASSETS=${assetBinding ? "present" : "absent"})`;
    throw err;
  }
}
