import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// P2-35：分享标签的降级。
// index.html 的 og:image / og:url / twitter:image 依赖 %VITE_SITE_URL%，而 Vite 的替换
// 有两种坏降级且都不报错：
//   · 变量已定义但为空（照抄 .env.example 的克隆者）→ 内容变成 "/share-card.png" 这类相对 URL，
//     社交爬虫要求绝对 URL，预览必坏；
//   · 变量根本没定义 → Vite 不替换，字面量 "%VITE_SITE_URL%/share-card.png" 原样进 DOM。
// 这里在 HTML 生成后（order:"post"，此时 %VITE_*% 已替换完）校验内容：
// 不是绝对 http(s) URL 的分享标签整条移除——宁可不输出标签，也不把坏 URL 发出去。
// 站点地址仍然只来自环境变量，不写死进仓库。
const OG_URL_TAG =
  /^[ \t]*<meta[^>]*(?:property="og:(?:image|url)"|name="twitter:image")[^>]*>[ \t]*\r?\n?/gm;

// P2-33：public/share-card.png 等素材被 .gitignore 忽略（维护者本地才有的真实图）。
// 被跟踪的 index.html 把 og:image / twitter:image 指向它，克隆仓库构建出的 dist/ 里
// 没有这个文件 → 分享预览必然 404。修法：被跟踪的**占位件**随仓库发布
// （public/placeholders/share-card.png），构建时探测本地有没有真图：
//   有真图 → 保持指向 /share-card.png（维护者本地覆盖机制不变）
//   没真图 → 改指向 /placeholders/share-card.png（克隆者的分享卡片不再破损）
// ⚠️ 必须相对**本配置文件**解析，不能用 CWD 相对路径（T15 复审 MUST-FIX 1）：
// 原先写 `path.resolve("public/share-card.png")`，评审把构建的工作目录换到 /tmp 后，
// 真图探测静默失败 ⇒ og:image 悄悄退化成占位件，而下面第三条注释与 README 都声称「有真图即保持」。
const SHARE_CARD_REAL = fileURLToPath(new URL("./public/share-card.png", import.meta.url));
const SHARE_CARD_PLACEHOLDER = "placeholders/share-card.png";
const SHARE_CARD_BASENAME = "share-card.png";

// 抽成纯函数便于用一次性脚本验证两个分支（见 audit-fix-20260914/task-15b-report.md）
export function applyShareCardFallback(html: string, hasRealShareCard: boolean): string {
  return html.replace(OG_URL_TAG, (tag) => {
    const content = /content="([^"]*)"/.exec(tag)?.[1] ?? "";
    // 不是绝对 http(s) URL → 整条移除，宁可不输出标签也不发坏 URL（P2-35）
    if (!/^https?:\/\/./.test(content)) return "";
    // 本地没有真图 → 指向被跟踪的占位件（P2-33）
    return hasRealShareCard ? tag : tag.replace(SHARE_CARD_BASENAME, SHARE_CARD_PLACEHOLDER);
  });
}

function shareTagFallback(): Plugin {
  return {
    name: "shuati:share-tag-fallback",
    transformIndexHtml: {
      order: "post",
      handler(html: string) {
        return applyShareCardFallback(html, existsSync(SHARE_CARD_REAL));
      },
    },
  };
}

// P2-33 补充（2026-09-17）：模板里的静态 src 会被 @vitejs/plugin-vue 编译成 import，
// 而 /contact-avatar.png、/wechat-qr.png 这两张真图被 .gitignore 忽略、只存在于维护者本地。
// ⇒ 干净 clone 上 Rollup 解析不到它们，**整个构建失败**（首次自动部署时实盘炸出；本地有真图，
//   所以一直复现不了）。修法与 shareTagFallback 同思路：真图缺失时把解析重定向到随仓库发布的
//   占位件；真图存在时返回 null 交给 Vite 原有行为，维护者本地覆盖机制不变。
const GITIGNORED_PUBLIC_ASSETS = [
  {
    real: fileURLToPath(new URL("./public/contact-avatar.png", import.meta.url)),
    placeholder: fileURLToPath(new URL("./public/placeholders/contact-avatar.png", import.meta.url)),
  },
  {
    real: fileURLToPath(new URL("./public/wechat-qr.png", import.meta.url)),
    placeholder: fileURLToPath(new URL("./public/placeholders/wechat-qr.png", import.meta.url)),
  },
];

function assetPlaceholderFallback(): Plugin {
  return {
    name: "shuati:asset-placeholder-fallback",
    enforce: "pre",
    resolveId(source) {
      if (!source.startsWith("/")) return null;
      const bare = source.split("?")[0];
      for (const p of GITIGNORED_PUBLIC_ASSETS) {
        const base = "/" + p.real.replace(/\\/g, "/").split("/").pop();
        if (bare === base && !existsSync(p.real)) return p.placeholder;
      }
      return null;
    },
  };
}

// P1-36：Service Worker 的「导航兜底」只应拦下本项目自己的路由。
// workbox 的 navigateFallback 默认会把任何未命中缓存的顶层导航都返回 index.html，
// 于是 /__auth/…（CloudBase 鉴权/回调）、/cloud-admin/…（管理台）、/calc/…（同源上的
// 滑稽计算器）都会被劫持成小兔错题本的首页——恰好只影响装了 PWA 的用户。
// 下面这份前缀表是**单一真值源**，denylist 由它派生。
//
// ⚠️ 必须与 `scripts/deploy-hosting.mjs` 的 `PROTECTED_PREFIXES` 保持一致（四个字符串逐字相同）。
//    该脚本整目录在 .gitignore 范围内、不在版本控制里，两处**无法互相 import**，
//    只能靠人工对齐：改动任意一处时请同步另一处（重建要点见 README「部署」小节）。
export const PROTECTED_PREFIXES = ["__auth/", "cloud-admin/", ".env", "calc/"];

// 由前缀表派生 denylist：转义正则元字符后加 `^/`，即「pathname 以该前缀开头」。
// 关于 '.env' 这类非目录前缀要不要写进来：写。`/.env`、`/.env.production` 既不是应用路由，
// 也不是静态资源；SW 若把它们兜底成 index.html，既掩盖了对象是否真的存在，也会让
// 「误把 env 文件传上静态托管」这类事故静默化（导航过去看到的是正常首页而不是 404/文件）。
// 代价仅是多排除一个不存在的路径，无副作用。
export const NAVIGATE_FALLBACK_DENYLIST = PROTECTED_PREFIXES.map(
  (prefix) => new RegExp("^/" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
);

// https://vite.dev/config/
// mode=desktop → 打包桌面版（Tauri）：
//   · base 改相对路径（asset:// 协议下绝对路径会 404）
//   · 关闭 Service Worker（asset:// 下无法注册，强开只会报错 + 缓存错乱）
export default defineConfig(({ mode }) => {
  const isDesktop = mode === "desktop";

  // 2026-09-25：把真实版本注入前端。此前设置页显示的「当前版本」是 updater.ts 里**写死的
  // '1.2.48-web'**（桌面版时代的空实现遗留），线上 1.2.53 的包里也是这个字符串——
  // 拿它判断「我跑的是哪版」必然误判。这里从 package.json 读版本号（不走 VITE_*，
  // 免得再踩「忘改服务器 build.env 就静默为空」那个坑）。
  const pkgVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

  return {
    base: isDesktop ? "./" : "/",
    define: { __APP_VERSION__: JSON.stringify(`${pkgVersion}-web`) },

    plugins: [
      vue(),
      shareTagFallback(),
      assetPlaceholderFallback(),
      ...(isDesktop
        ? []
        : [
            VitePWA({
              registerType: "autoUpdate",
              includeAssets: ["logo-64.png", "logo-192.png", "logo-256.png", "logo-512.png", "logo.gif", "placeholders/contact-avatar.png", "placeholders/wechat-qr.png", "icons/study.gif", "icons/exam.gif", "icons/mix.gif", "icons/flame.gif", "icons/plan.gif", "icons/logo-green.gif", "icons/logo-blue.gif", "icons/logo-purple.gif", "icons/logo-pink.gif", "icons/logo-orange.gif", "icons/logo-teal.gif", "icons/logo-tech.gif", "icons/logo-forest.gif", "icons/logo-space.gif", "icons/logo-cloud.gif"],
              manifest: {
                name: "小兔错题本（网页版）",
                short_name: "小兔错题本",
                description: "智能题库练习应用 · 导入即刷 · AI 自动解析",
                // 与 index.html 的 <html lang> 保持一致：不设时插件默认生成 "en"，
                // 会让屏幕阅读器用英文读中文、爬虫误判语言（P2-34）
                lang: "zh-CN",
                theme_color: "#42b883",
                background_color: "#ffffff",
                display: "standalone",
                orientation: "portrait",
                icons: [
                  {
                    src: "logo-192.png",
                    sizes: "192x192",
                    type: "image/png",
                  },
                  {
                    src: "logo-512.png",
                    sizes: "512x512",
                    type: "image/png",
                  },
                ],
              },
              workbox: {
                globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                // 免拦截同源上不属于本项目的路径前缀（P1-36）：/__auth/、/cloud-admin/、/.env、/calc/。
                // 列表来自顶部 PROTECTED_PREFIXES，与 scripts/deploy-hosting.mjs 对齐。
                navigateFallbackDenylist: NAVIGATE_FALLBACK_DENYLIST,
              },
            }),
          ]),
    ],

    // 通用配置（非 Tauri 专用）
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
    },
    build: {
      target: "es2019",
      // 桌面版：dist 由打包前手动清理（vite 自动清空 dist/assets 会触发环境 safe-delete 批量拦截）
      emptyOutDir: !isDesktop,
    },
  };
});
