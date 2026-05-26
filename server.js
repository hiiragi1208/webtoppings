const express = require("express");
const https = require("https");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const zlib = require("zlib");

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==============================
// URL取得（リダイレクト追跡）
// ==============================
function fetchUrl(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        "Accept": options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Host": parsed.hostname,
        ...(options.cookie ? { "Cookie": options.cookie } : {}),
        ...(options.referer ? { "Referer": options.referer } : {}),
        ...(options.origin ? { "Origin": options.origin } : {}),
        ...(options.extraHeaders || {}),
      },
    };
    const req = lib.request(reqOptions, (res) => {
      const chunks = [];
      const enc = res.headers["content-encoding"];
      let stream = res;
      if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
      else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
      stream.on("data", c => chunks.push(c));
      stream.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
        url: targetUrl,
      }));
      stream.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error("タイムアウト")); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ==============================
// URLをプロキシ経由に変換
// ==============================
function toProxy(url, baseOrigin, params) {
  if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("javascript:") || url.startsWith("mailto:") || url.startsWith("tel:") || url.startsWith("#")) return url;
  try {
    let abs;
    if (url.startsWith("//")) abs = "https:" + url;
    else if (url.startsWith("/")) abs = baseOrigin + url;
    else if (url.startsWith("http")) abs = url;
    else abs = baseOrigin + "/" + url;
    const q = new URLSearchParams({ url: abs, tp: params.tp || "", css: params.css || "", js: params.js || "" });
    return `/p?${q}`;
  } catch(e) { return url; }
}

// ==============================
// トッピングスクリプト
// ==============================
function toppingScript(toppings, customCSS, customJS, proxyBase) {
  const f = {
    dark: toppings.includes("darkMode"),
    ad: toppings.includes("adBlock"),
    read: toppings.includes("readingMode"),
    trans: toppings.includes("translate"),
    custom: toppings.includes("customCode"),
  };
  return `<script id="__wt__">(function(){
const F=${JSON.stringify(f)};
const CSS=${JSON.stringify(customCSS||"")};
const JS=${JSON.stringify(customJS||"")};
const BASE=${JSON.stringify(proxyBase)};

// サービスワーカー登録（動的リソースをプロキシ経由に）
if('serviceWorker' in navigator){
  const swCode = \`
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if(url.startsWith(self.location.origin+'/p?') || url.startsWith(self.location.origin+'/sw.js')) return;
  if(url.startsWith('http') && !url.startsWith(self.location.origin)){
    const proxyUrl = self.location.origin+'/p?url='+encodeURIComponent(url)+'&tp=&css=&js=';
    e.respondWith(fetch(proxyUrl, {headers: {'Accept': e.request.headers.get('Accept')||'*/*'}}));
  }
});
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
  \`;
  const blob = new Blob([swCode], {type:'application/javascript'});
  const swUrl = URL.createObjectURL(blob);
  navigator.serviceWorker.register(swUrl, {scope:'/'}).catch(()=>{});
}

if(F.dark){
  const s=document.createElement('style');
  s.textContent='html,body{background:#111!important;color:#ddd!important}a{color:#7eb8f7!important}img,video{filter:brightness(.85)}input,textarea,select{background:#1e1e1e!important;color:#ddd!important;border:1px solid #444!important}';
  document.head.appendChild(s);
}
if(F.ad){
  const SEL=['ins.adsbygoogle','[class*="advertisement"]','[class*="ad-banner"]','div[id^="div-gpt-ad"]','.sponsored','[data-ad-slot]','iframe[src*="doubleclick"]','iframe[src*="googlesyndication"]'];
  const rm=()=>SEL.forEach(s=>document.querySelectorAll(s).forEach(el=>{if(el.offsetWidth>10)el.style.display='none'}));
  rm();
  new MutationObserver(rm).observe(document.documentElement,{childList:true,subtree:true});
}
if(F.read){
  const btn=document.createElement('button');
  btn.textContent='📖';
  btn.title='リーディングモード';
  btn.style.cssText='position:fixed;bottom:80px;right:16px;width:44px;height:44px;background:#222;color:#fff;border:none;border-radius:50%;font-size:20px;cursor:pointer;z-index:2147483646;box-shadow:0 2px 12px rgba(0,0,0,.5)';
  btn.onclick=()=>{
    const el=document.querySelector('article,main,[role="main"],.post-content,.entry-content')||document.body;
    const d=document.createElement('div');
    d.style.cssText='position:fixed;inset:0;background:#fdfaf4;color:#222;overflow-y:auto;z-index:2147483647;font-family:Georgia,serif;padding:60px 20px';
    d.innerHTML='<button onclick="this.parentNode.remove()" style="position:fixed;top:12px;right:12px;background:#e55;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:14px">✕ 閉じる</button><div style="max-width:700px;margin:0 auto"><h1 style="font-size:1.8rem;margin-bottom:1rem">'+document.title+'</h1><div style="font-size:1.1rem;line-height:1.9;white-space:pre-wrap">'+el.innerText.slice(0,10000)+'</div></div>';
    document.body.appendChild(d);
  };
  document.body.appendChild(btn);
}
if(F.trans){
  const btn=document.createElement('button');
  btn.textContent='🌐 翻訳';
  btn.style.cssText='position:fixed;bottom:134px;right:16px;padding:8px 14px;background:#1a73e8;color:#fff;border:none;border-radius:20px;font-size:13px;cursor:pointer;z-index:2147483646;box-shadow:0 2px 8px rgba(0,0,0,.4)';
  btn.onclick=()=>window.open('https://translate.google.com/translate?sl=auto&tl=ja&u='+encodeURIComponent(location.href),'_blank');
  document.body.appendChild(btn);
}
if(F.custom&&CSS){const s=document.createElement('style');s.textContent=CSS;document.head.appendChild(s);}
if(F.custom&&JS){try{eval(JS)}catch(e){}}

const bar=document.createElement('div');
bar.style.cssText='position:fixed;bottom:0;left:0;right:0;background:rgba(15,15,15,.93);color:#fff;padding:7px 16px;display:flex;align-items:center;gap:10px;font-family:system-ui,sans-serif;font-size:13px;z-index:2147483647;backdrop-filter:blur(10px);border-top:1px solid rgba(255,255,255,.08)';
bar.innerHTML='<span style="font-weight:800;letter-spacing:.03em">🍕 WebToppings</span><span style="opacity:.5;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" id="__wt_url__"></span><button onclick="this.parentNode.style.display=\'none\'" style="background:transparent;border:none;color:#aaa;cursor:pointer;font-size:16px;flex-shrink:0">✕</button>';
document.body.appendChild(bar);
try{document.getElementById('__wt_url__').textContent=document.location.href;}catch(e){}
})();</script>`;
}

// ==============================
// HTML書き換え
// ==============================
function rewriteHtml(html, origin, params) {
  html = html.replace(/<base[^>]*>/gi, "");

  // href / src / action / srcset を書き換え
  html = html.replace(/\s(href|src|action)=["']([^"']+)["']/gi, (m, attr, url) => {
    if (url.startsWith("data:") || url.startsWith("#") || url.startsWith("javascript:") || url.startsWith("mailto:") || url.startsWith("tel:")) return m;
    return ` ${attr}="${toProxy(url, origin, params)}"`;
  });

  html = html.replace(/srcset=["']([^"']+)["']/gi, (_, srcset) => {
    const rw = srcset.split(",").map(part => {
      const [url, ...rest] = part.trim().split(/\s+/);
      if (!url || url.startsWith("data:")) return part;
      return [toProxy(url, origin, params), ...rest].join(" ");
    }).join(", ");
    return `srcset="${rw}"`;
  });

  // CSS内 url()
  html = html.replace(/url\((['"]?)([^'")]+)\1\)/gi, (m, q, url) => {
    if (url.startsWith("data:") || url.startsWith("#")) return m;
    return `url("${toProxy(url, origin, params)}")`;
  });

  // <meta http-equiv="refresh"> のURLも書き換え
  html = html.replace(/(content=["']\d+;\s*url=)([^"']+)(["'])/gi, (m, pre, url, post) => {
    return pre + toProxy(url, origin, params) + post;
  });

  // トッピング注入
  const script = toppingScript(
    params.tp ? params.tp.split(",") : [],
    decodeURIComponent(params.css || ""),
    decodeURIComponent(params.js || ""),
    BASE_URL
  );
  html = html.includes("</body>") ? html.replace(/<\/body>/i, `${script}</body>`) : html + script;

  return html;
}

// ==============================
// CSS書き換え
// ==============================
function rewriteCss(css, origin, params) {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/gi, (m, q, url) => {
    if (url.startsWith("data:") || url.startsWith("#")) return m;
    return `url("${toProxy(url, origin, params)}")`;
  });
}

// ==============================
// プロキシルート /p
// ==============================
app.all("/p", async (req, res) => {
  const params = { ...req.query };
  let url = params.url;
  if (!url) return res.status(400).send("url required");
  if (!/^https?:\/\//.test(url)) url = "https://" + url;

  const method = req.method.toUpperCase();

  try {
    const result = await fetchUrl(url, {
      method,
      cookie: req.headers.cookie || "",
      referer: req.headers.referer || "",
      accept: req.headers.accept || "",
      origin: (() => { try { const u = new URL(url); return `${u.protocol}//${u.hostname}`; } catch(e) { return ""; } })(),
      body: (method === "POST" && req.body) ? new URLSearchParams(req.body).toString() : undefined,
    });

    const ct = result.headers["content-type"] || "";
    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.hostname}`;

    // セキュリティヘッダーを除去して転送
    const skipH = new Set(["content-encoding","content-security-policy","content-security-policy-report-only","x-frame-options","strict-transport-security","transfer-encoding","connection","keep-alive","content-length"]);
    Object.entries(result.headers).forEach(([k, v]) => {
      if (!skipH.has(k.toLowerCase())) try { res.setHeader(k, v); } catch(e) {}
    });

    // Cookie転送
    if (result.headers["set-cookie"]) {
      const cookies = [result.headers["set-cookie"]].flat().map(c =>
        c.replace(/;\s*Secure/gi,"").replace(/;\s*SameSite=[^;]*/gi,"").replace(/;\s*Domain=[^;]*/gi,"")
      );
      res.setHeader("set-cookie", cookies);
    }

    // リダイレクト
    if ([301,302,303,307,308].includes(result.status) && result.headers.location) {
      const loc = result.headers.location;
      const absLoc = loc.startsWith("http") ? loc : (loc.startsWith("/") ? origin + loc : origin + "/" + loc);
      const q = new URLSearchParams({ url: absLoc, tp: params.tp||"", css: params.css||"", js: params.js||"" });
      return res.redirect(result.status === 303 ? 302 : result.status, `/p?${q}`);
    }

    if (ct.includes("text/html")) {
      let html = result.body.toString("utf-8");
      html = rewriteHtml(html, origin, params);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(result.status).send(html);
    }

    if (ct.includes("text/css")) {
      let cssText = result.body.toString("utf-8");
      cssText = rewriteCss(cssText, origin, params);
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      return res.status(result.status).send(cssText);
    }

    return res.status(result.status).send(result.body);

  } catch(err) {
    console.error("[proxy error]", err.message, url);
    res.status(502).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>エラー</title></head><body style="font-family:sans-serif;background:#0d0c0a;color:#f0ead8;padding:40px;max-width:600px;margin:0 auto"><h2>🍕 接続エラー</h2><p style="color:#aaa">${err.message}</p><p><a href="/" style="color:#f5a623">← トップに戻る</a></p></body></html>`);
  }
});

// 旧エンドポイントの互換性
app.get("/proxy", (req, res) => res.redirect(`/p?url=${req.query.url||""}&tp=${req.query.toppings||""}&css=${req.query.css||""}&js=${req.query.js||""}`));

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`🍕 WebToppings起動: http://localhost:${PORT}`));
