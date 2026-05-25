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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Accept-Language": "ja,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Host": parsed.hostname,
        ...(reqHeaders.cookie ? { Cookie: reqHeaders.cookie } : {}),
        ...(reqHeaders.referer ? { Referer: reqHeaders.referer } : {}),
        ...(reqHeaders.authorization ? { Authorization: reqHeaders.authorization } : {}),
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

function resolveUrl(url, pageUrl) {
  try {
    if (!url || typeof url !== "string") return null;
    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("javascript:") || url.startsWith("mailto:") || url.startsWith("tel:") || url.startsWith("#")) return null;
    return new URL(url, pageUrl).href;
  } catch(e) { return null; }
}

function toProxyUrl(url, pageUrl, tp, css, js) {
  const abs = resolveUrl(url, pageUrl);
  if (!abs) return url;
  return `/proxy?url=${encodeURIComponent(abs)}&toppings=${encodeURIComponent(tp||"")}&css=${encodeURIComponent(css||"")}&js=${encodeURIComponent(js||"")}`;
}

function rewriteJs(jsText, pageUrl, tp) {
  let result = jsText;

  // APIドメインを書き換え
  const apiDomains = [
    "api.prod.cloudmoonapp.com",
    "api.cloudmoon.cloudbatata.com",
    "shop.cloudmoonapp.com",
  ];
  for (const domain of apiDomains) {
    result = result.replace(
      new RegExp(`https://${domain.replace(/\./g, "\\.")}`, "g"),
      `/proxy?url=https%3A%2F%2F${domain}`
    );
  }

  // ES Module の相対import/exportパスをプロキシURLに書き換え
  // from"../chunks/xxx" → from"/proxy?url=絶対URL"
  // from"./xxx" → from"/proxy?url=絶対URL"
  result = result.replace(
    /(?:from|import)\s*["'](\.\.[^"']+|\.\/[^"']+)["']/g,
    (m, relPath) => {
      const abs = resolveUrl(relPath, pageUrl);
      if (!abs) return m;
      const proxyUrl = `/proxy?url=${encodeURIComponent(abs)}&toppings=${encodeURIComponent(tp||"")}`;
      return m.replace(relPath, proxyUrl);
    }
  );

  return result;
}

function rewriteHtml(html, pageUrl, toppings, css, js) {
  const tp = Array.isArray(toppings) ? toppings.join(",") : (toppings||"");

  html = html.replace(/<base[^>]*>/gi, "");

  html = html.replace(/(<link[^>]+href=["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
    const abs = resolveUrl(url, pageUrl);
    if (!abs) return m;
    return pre + toProxyUrl(url, pageUrl, tp, css, js) + post;
  });

  html = html.replace(/(<script[^>]+src=["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
    const abs = resolveUrl(url, pageUrl);
    if (!abs) return m;
    return pre + toProxyUrl(url, pageUrl, tp, css, js) + post;
  });

  html = html.replace(/(<img[^>]+src=["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
    const abs = resolveUrl(url, pageUrl);
    if (!abs) return m;
    return pre + toProxyUrl(url, pageUrl, tp, css, js) + post;
  });

  html = html.replace(/(<a[^>]+href=["'])([^"'#][^"']*?)(["'])/gi, (m, pre, url, post) => {
    if (url.startsWith("mailto:") || url.startsWith("tel:") || url.startsWith("javascript")) return m;
    const abs = resolveUrl(url, pageUrl);
    if (!abs) return m;
    return pre + toProxyUrl(url, pageUrl, tp, css, js) + post;
  });

  html = html.replace(/(<form[^>]+action=["'])([^"']+)(["'])/gi, (m, pre, url, post) => {
    const abs = resolveUrl(url, pageUrl);
    if (!abs) return m;
    return pre + toProxyUrl(url, pageUrl, tp, css, js) + post;
  });

  const fetchHook = `<script>
(function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
  }
  const PROXY_BASE = "/proxy?url=";
  const TP = ${JSON.stringify(tp)};
  function shouldProxy(url) {
    if (!url || typeof url !== "string") return false;
    if (url.startsWith("/proxy?")) return false;
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    try {
      const u = new URL(url, location.href);
      return u.origin !== location.origin;
    } catch(e) { return false; }
  }
  function proxyUrl(url) {
    if (!shouldProxy(url)) return url;
    try {
      const abs = new URL(url, location.href).href;
      return PROXY_BASE + encodeURIComponent(abs) + "&toppings=" + encodeURIComponent(TP);
    } catch(e) { return url; }
  }
  const _fetch = window.fetch.bind(window);
  window.fetch = function(input, opts) {
    if (typeof input === "string") input = proxyUrl(input);
    else if (input instanceof Request) {
      const newUrl = proxyUrl(input.url);
      if (newUrl !== input.url) input = new Request(newUrl, input);
    }
    return _fetch(input, opts);
  };
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (url) url = proxyUrl(String(url));
    return _open.call(this, method, url, ...args);
  };
})();
</script>`;

  if (html.includes("<head>")) {
    html = html.replace("<head>", "<head>" + fetchHook);
  } else if (html.includes("<head")) {
    html = html.replace(/<head[^>]*>/, (m) => m + fetchHook);
  } else {
    html = fetchHook + html;
  }

  const toppingArr = Array.isArray(toppings) ? toppings : tp.split(",").filter(Boolean);
  const script = buildToppingScript(toppingArr, css, js);
  html = html.includes("</body>") ? html.replace(/<\/body>/i, `${script}</body>`) : html + script;

  return html;
}

function rewriteCss(cssText, pageUrl, toppings, css, js) {
  const tp = Array.isArray(toppings) ? toppings.join(",") : (toppings||"");
  return cssText.replace(/url\(["']?([^"')]+)["']?\)/gi, (m, url) => {
    const abs = resolveUrl(url, pageUrl);
    if (!abs) return m;
    return `url("${toProxyUrl(url, pageUrl, tp, css, js)}")`;
  });
}

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
    s.textContent = "html,body{background:#0f0f0f!important;color:#e0e0e0!important}";
    document.head.appendChild(s);
  }
  if (FLAGS.adBlock) {
    const SEL = ["iframe[src*='doubleclick']","iframe[src*='googlesyndication']","ins.adsbygoogle","div[id*='ad-']","div[class*='ad-banner']"];
    function rm() { SEL.forEach(s => document.querySelectorAll(s).forEach(el => { if(el.parentNode) el.parentNode.removeChild(el); })); }
    rm();
    new MutationObserver(rm).observe(document.documentElement, {childList:true, subtree:true});
  }
  if (FLAGS.readingMode) {
    const btn = document.createElement("button");
    btn.textContent = "📖";
    btn.style.cssText = "position:fixed;bottom:80px;right:16px;width:44px;height:44px;border-radius:50%;background:#f5a623;border:none;font-size:20px;cursor:pointer;z-index:99999";
    btn.onclick = () => {
      let main = document.querySelector("article,main,[role='main'],.content,.post-content");
      const o = document.createElement("div");
      o.style.cssText = "position:fixed;inset:0;background:#fdfaf4;color:#2c2c2c;overflow:auto;z-index:99999;padding:40px;font-size:18px;line-height:1.8";
      o.innerHTML = '<button onclick="this.parentNode.remove()" style="position:fixed;top:16px;right:16px;background:#f5a623;border:none;padding:8px 16px;border-radius:8px;cursor:pointer">✕ 閉じる</button>' + (main ? main.innerHTML : document.body.innerHTML);
      document.body.appendChild(o);
    };
    document.body.appendChild(btn);
  }
  if (FLAGS.translate) {
    const btn = document.createElement("button");
    btn.textContent = "🌐 翻訳";
    btn.style.cssText = "position:fixed;bottom:130px;right:16px;padding:8px 14px;background:#4285f4;color:#fff;border:none;border-radius:20px;font-size:13px;cursor:pointer;z-index:99999";
    btn.onclick = () => window.open("https://translate.google.com/translate?sl=auto&tl=ja&u=" + encodeURIComponent(location.href));
    document.body.appendChild(btn);
  }
  if (FLAGS.customCode && CUSTOM_CSS) { const s=document.createElement("style"); s.textContent=CUSTOM_CSS; document.head.appendChild(s); }
  if (FLAGS.customCode && CUSTOM_JS) { try{eval(CUSTOM_JS)}catch(e){} }
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:rgba(20,20,20,0.85);color:#fff;padding:4px 12px;font-size:12px;z-index:99999;display:flex;align-items:center;gap:8px";
  bar.innerHTML = '<span style="font-weight:700">🍕 WebToppings</span>';
  document.body.appendChild(bar);
})();
</script>`;
}

app.get("/proxy", async (req, res) => {
  let { url, toppings: tp, css, js } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });
  if (!/^https?:\/\//.test(url)) url = "https://" + url;

  const toppings = tp ? tp.split(",").filter(Boolean) : [];

  try {
    const result = await fetchUrl(url, req.headers);
    const ct = result.headers["content-type"] || "";

    res.removeHeader("content-security-policy");
    res.removeHeader("x-frame-options");
    res.removeHeader("x-content-type-options");
    res.removeHeader("strict-transport-security");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if (result.headers["set-cookie"]) {
      const cookies = Array.isArray(result.headers["set-cookie"])
        ? result.headers["set-cookie"]
        : [result.headers["set-cookie"]];
      const rewritten = cookies.map(c =>
        c.replace(/;\s*secure/gi, "").replace(/;\s*samesite=[^;]*/gi, "")
      );
      res.setHeader("set-cookie", rewritten);
    }

    if ([301,302,303,307,308].includes(result.status)) {
      const location = result.headers.location;
      if (location) {
        const abs = resolveUrl(location, url) || location;
        return res.redirect(result.status, `/proxy?url=${encodeURIComponent(abs)}&toppings=${tp||""}&css=${css||""}&js=${js||""}`);
      }
    }

    if (ct.includes("text/html")) {
      let html = result.body.toString("utf-8");
      html = rewriteHtml(html, url, toppings, css || "", js || "");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(result.status).send(html);
    } else if (ct.includes("text/css")) {
      let cssText = result.body.toString("utf-8");
      cssText = rewriteCss(cssText, url, toppings, css || "", js || "");
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      res.status(result.status).send(cssText);
    } else if (ct.includes("javascript")) {
      let jsText = result.body.toString("utf-8");
      jsText = rewriteJs(jsText, url, tp || "");
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.status(result.status).send(jsText);
    } else if (ct.includes("application/json")) {
      res.setHeader("Content-Type", "application/json");
      res.status(result.status).send(result.body);
    } else {
      const safe = ["content-type","cache-control","etag","last-modified"];
      safe.forEach(h => { if(result.headers[h]) res.setHeader(h, result.headers[h]); });
      res.status(result.status).send(result.body);
    }
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(502).send(`<html><body style="font-family:sans-serif;padding:40px;background:#1a1a1a;color:#fff"><h2>🍕 プロキシエラー</h2><p>${err.message}</p><p><a href="/" style="color:#f5a623">← 戻る</a></p></body></html>`);
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`🍕 WebToppings: http://localhost:${PORT}`));
