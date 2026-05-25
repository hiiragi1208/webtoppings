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

function fetchUrl(targetUrl) {
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
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Host: parsed.hostname,
      },
    };
    const req = lib.request(options, (res) => {
      const chunks = [];
      const encoding = res.headers["content-encoding"];
      let stream = res;
      if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
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
    s.textContent = "html,body{background:#0f0f0f!important;color:#e0e0e0!important}a{color:#7eb8f7!important}img,video{filter:brightness(0.85)}input,textarea,select{background:#1e1e1e!important;color:#e0e0e0!important;border:1px solid #444!important}";
    document.head.appendChild(s);
  }
  if (FLAGS.adBlock) {
    const SEL = ["iframe[src*='ad']","iframe[src*='doubleclick']","ins.adsbygoogle","[class*='advertisement']","[class*='banner']","div[id^='div-gpt-ad']",".sponsored"];
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

function rewriteHtml(html, origin, toppings, customCSS, customJS) {
  html = html.replace(/<base[^>]*>/gi, "");
  html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`);
  html = html.replace(/href="(\/[^"]*?)"/gi, (_, p) => `href="/proxy?url=${encodeURIComponent(origin + p)}"`);
  const script = buildToppingScript(toppings, customCSS, customJS);
  html = html.replace(/<\/body>/i, `${script}</body>`);
  return html;
}

app.get("/proxy", async (req, res) => {
  let { url, toppings: tp, css, js } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const toppings = tp ? tp.split(",") : [];
  try {
    const result = await fetchUrl(url);
    const ct = result.headers["content-type"] || "";
    if (ct.includes("text/html")) {
      const parsed = new URL(url);
      const origin = `${parsed.protocol}//${parsed.hostname}`;
      let html = rewriteHtml(result.body.toString("utf-8"), origin, toppings, css, js);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.removeHeader("content-security-policy");
      res.removeHeader("x-frame-options");
      res.send(html);
    } else {
      const safe = ["content-type","cache-control","etag"];
      safe.forEach(h => { if(result.headers[h]) res.setHeader(h, result.headers[h]); });
      res.send(result.body);
    }
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`🍕 WebToppings: http://localhost:${PORT}`));
