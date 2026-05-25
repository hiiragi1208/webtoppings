const express = require("express");
const https = require("https");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const zlib = require("zlib");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ==============================
// URL取得
// ==============================
function fetchUrl(targetUrl, reqHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        Accept: reqHeaders.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Host: parsed.hostname,
        ...(reqHeaders.cookie ? { Cookie: reqHeaders.cookie } : {}),
        ...(reqHeaders.referer ? { Referer: reqHeaders.referer } : {}),
      },
    };
    const req = lib.request(options, (res) => {
      const chunks = [];
      const encoding = res.headers["content-encoding"];
      let stream = res;
      if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

// ==============================
// URLをプロキシ経由に書き換え
// ==============================
function toProxyUrl(url, origin, toppings, css, js) {
  try {
    let abs = url;
    if (url.startsWith("//")) abs = "https:" + url;
    else if (url.startsWith("/")) abs = origin + url;
    else if (!url.startsWith("http")) abs = origin + "/" + url;
    return `/proxy?url=${encodeURIComponent(abs)}&toppings=${toppings}&css=${css}&js=${js}`;
  } catch(e) { return url; }
}

// ==============================
// トッピングスクリプト
// ==============================
function buildToppingScript(toppings, customCSS, customJS) {
  const flags = {
    darkMode: toppings.includes("darkMode"),
    adBlock: toppings.includes("adBlock"),
    translate: toppings.includes("translate"),
    readingMode: toppings.includes("readingMode"),
    customCode: toppings.includes("customCode"),
  };
  return `<script id="__webtoppings__">
(function() {
  const FLAGS = ${JSON.stringify(flags)};
  const CUSTOM_CSS = ${JSON.stringify(customCSS || "")};
  const CUSTOM_JS = ${JSON.stringify(customJS || "")};
  if (FLAGS.darkMode) {
    const s = document.createElement("style");
    s.textContent = "html,body{background:#0f0f0f!important;color:#e0e0e0!important}a{color:#7eb8f7!important}img,video{filter:brightness(0.85)}input,textarea,select{background:#1e1e1e!important;color:#e0e0e0!important;border:1px solid #444!important}";
    document.head.appendChild(s);
  }
  if (FLAGS.adBlock) {
    const SEL = ["iframe[src*='doubleclick']","iframe[src*='googlesyndication']","ins.adsbygoogle","[class*='advertisement']","div[id^='div-gpt-ad']",".sponsored","[data-ad]","[aria-label='advertisement']"];
    function rm() { SEL.forEach(s => document.querySelectorAll(s).forEach(el => { if(el.offsetWidth>20) el.style.display="none"; })); }
    rm();
    new MutationObserver(rm).observe(document.documentElement,{childList:true,subtree:true});
  }
  if (FLAGS.readingMode) {
    const btn = document.createElement("button");
    btn.textContent = "📖";
    btn.style.cssText = "position:fixed;bottom:80px;right:16px;width:44px;height:44px;background:#333;color:#fff;border:none;border-radius:50%;font-size:18px;cursor:pointer;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.4)";
    btn.onclick = () => {
      let main = document.querySelector("article,main,[role='main'],.content,.post-content") || document.body;
      const o = document.createElement("div");
      o.style.cssText = "position:fixed;inset:0;background:#fdfaf4;color:#2c2c2c;overflow-y:auto;z-index:999999;font-family:Georgia,serif;padding:60px 24px";
      o.innerHTML = '<button onclick="this.parentNode.remove()" style="position:fixed;top:16px;right:16px;background:#e55;color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer">✕ 閉じる</button><div style="max-width:680px;margin:0 auto"><h1 style="font-size:2rem;margin-bottom:1.5rem">'+document.title+'</h1><div style="font-size:1.125rem;line-height:1.9;white-space:pre-wrap">'+main.innerText.slice(0,8000)+'</div></div>';
      document.body.appendChild(o);
    };
    document.body.appendChild(btn);
  }
  if (FLAGS.translate) {
    const btn = document.createElement("button");
    btn.textContent = "🌐 翻訳";
    btn.style.cssText = "position:fixed;bottom:130px;right:16px;padding:8px 14px;background:#1a73e8;color:#fff;border:none;border-radius:20px;font-size:13px;cursor:pointer;z-index:99999;box-shadow:0 2px 8px rgba(0,0,0,0.4)";
    btn.onclick = () => window.open("https://translate.google.com/translate?sl=auto&tl=ja&u="+encodeURIComponent(location.href),"_blank");
    document.body.appendChild(btn);
  }
  if (FLAGS.customCode && CUSTOM_CSS) { const s=document.createElement("style"); s.textContent=CUSTOM_CSS; document.head.appendChild(s); }
  if (FLAGS.customCode && CUSTOM_JS) { try{eval(CUSTOM_JS)}catch(e){} }
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:rgba(20,20,20,0.92);color:#fff;padding:8px 16px;display:flex;align-items:center;gap:12px;font-family:system-ui,sans-serif;z-index:2147483647;backdrop-filter:blur(8px);border-top:1px solid rgba(255,255,255,0.1)";
  bar.innerHTML = '<span style="font-weight:700;font-size:13px">🍕 WebToppings</span><button onclick="this.parentNode.style.display=\'none\'" style="margin-left:auto;background:transparent;border:none;color:#fff;cursor:pointer;font-size:14px">✕</button>';
  document.body.appendChild(bar);
})();
</script>`;
}

// ==============================
// HTML書き換え（全リソースをプロキシ経由に）
// ==============================
function rewriteHtml(html, origin, toppings, css, js) {
  const tp = toppings.join(",");

  // base要素を除去
  html = html.replace(/<base[^>]*>/gi, "");

  // <link href="..."> CSS
  html = html.replace(/(<link[^>]+href=["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
    if (url.startsWith("data:") || url.startsWith("#")) return m;
    return pre + toProxyUrl(url, origin, tp, css, js) + post;
  });

  // <script src="...">
  html = html.replace(/(<script[^>]+src=["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
    if (url.startsWith("data:")) return m;
    return pre + toProxyUrl(url, origin, tp, css, js) + post;
  });

  // <img src="...">
  html = html.replace(/(<img[^>]+src=["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
    if (url.startsWith("data:")) return m;
    return pre + toProxyUrl(url, origin, tp, css, js) + post;
  });

  // <a href="...">
  html = html.replace(/(<a[^>]+href=["'])([^"'#][^"']*)(["'])/gi, (m, pre, url, post) => {
    if (url.startsWith("mailto:") || url.startsWith("tel:") || url.startsWith("javascript:")) return m;
    return pre + toProxyUrl(url, origin, tp, css, js) + post;
  });

  // <form action="...">
  html = html.replace(/(<form[^>]+action=["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
    return pre + toProxyUrl(url, origin, tp, css, js) + post;
  });

  // srcset
  html = html.replace(/srcset=["']([^"']+)["']/gi, (m, srcset) => {
    const rewritten = srcset.replace(/([^\s,]+)(\s*(?:\d+[wx])?)/g, (sm, url, descriptor) => {
      if (url.startsWith("data:")) return sm;
      return toProxyUrl(url, origin, tp, css, js) + descriptor;
    });
    return `srcset="${rewritten}"`;
  });

  // CSS内のurl()
  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (m, url) => {
    if (url.startsWith("data:") || url.startsWith("#")) return m;
    return `url("${toProxyUrl(url, origin, tp, css, js)}")`;
  });

  // トッピングスクリプト注入
  const script = buildToppingScript(toppings, css, js);
  if (html.includes("</body>")) {
    html = html.replace(/<\/body>/i, `${script}</body>`);
  } else {
    html += script;
  }

  return html;
}

// ==============================
// CSS書き換え
// ==============================
function rewriteCss(css, origin, toppings, customCss, customJs) {
  const tp = toppings.join(",");
  return css.replace(/url\(["']?([^"')]+)["']?\)/gi, (m, url) => {
    if (url.startsWith("data:") || url.startsWith("#")) return m;
    return `url("${toProxyUrl(url, origin, tp, customCss, customJs)}")`;
  });
}

// ==============================
// プロキシエンドポイント
// ==============================
app.get("/proxy", async (req, res) => {
  let { url, toppings: tp, css, js } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });
  if (!/^https?:\/\//.test(url)) url = "https://" + url;

  const toppings = tp ? tp.split(",").filter(Boolean) : [];

  try {
    const result = await fetchUrl(url, {
      cookie: req.headers.cookie,
      referer: req.headers.referer,
      accept: req.headers.accept,
    });

    const ct = result.headers["content-type"] || "";

    // レスポンスヘッダーの設定（セキュリティ系を除去）
    const skipHeaders = [
      "content-encoding", "content-security-policy",
      "content-security-policy-report-only", "x-frame-options",
      "strict-transport-security", "transfer-encoding",
      "connection", "keep-alive",
    ];
    Object.entries(result.headers).forEach(([k, v]) => {
      if (!skipHeaders.includes(k.toLowerCase())) {
        try { res.setHeader(k, v); } catch(e) {}
      }
    });

    // Cookie転送
    if (result.headers["set-cookie"]) {
      const cookies = Array.isArray(result.headers["set-cookie"])
        ? result.headers["set-cookie"]
        : [result.headers["set-cookie"]];
      const rewritten = cookies.map(c =>
        c.replace(/;\s*secure/gi, "").replace(/;\s*samesite=[^;]*/gi, "")
      );
      res.setHeader("set-cookie", rewritten);
    }

    // リダイレクト処理
    if ([301,302,303,307,308].includes(result.status)) {
      const location = result.headers.location;
      if (location) {
        const parsed = new URL(url);
        const origin = `${parsed.protocol}//${parsed.hostname}`;
        const absLocation = location.startsWith("http") ? location : origin + location;
        return res.redirect(result.status, `/proxy?url=${encodeURIComponent(absLocation)}&toppings=${tp||""}&css=${css||""}&js=${js||""}`);
      }
    }

    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.hostname}`;

    if (ct.includes("text/html")) {
      let html = result.body.toString("utf-8");
      html = rewriteHtml(html, origin, toppings, css || "", js || "");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(result.status).send(html);

    } else if (ct.includes("text/css")) {
      let cssText = result.body.toString("utf-8");
      cssText = rewriteCss(cssText, origin, toppings, css || "", js || "");
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      res.status(result.status).send(cssText);

    } else {
      res.status(result.status).send(result.body);
    }

  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(502).send(`<html><body style="font-family:sans-serif;padding:40px;background:#0d0c0a;color:#f0ead8">
      <h2>🍕 プロキシエラー</h2>
      <p>${err.message}</p>
      <p><a href="/" style="color:#f5a623">← 戻る</a></p>
    </body></html>`);
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`🍕 WebToppings: http://localhost:${PORT}`));
