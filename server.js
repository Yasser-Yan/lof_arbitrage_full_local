const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec, spawnSync } = require("child_process");

const HOST = "127.0.0.1";
const PORT = 8787;
const APP_DIR = __dirname;
const RUNNING_FROM_SOURCE = (process.argv[1] || "").toLowerCase().endsWith("server.js");
const RUNTIME_DIR = RUNNING_FROM_SOURCE ? APP_DIR : path.dirname(process.execPath);
const CONFIG_FILE = path.join(RUNTIME_DIR, "funds_config.json");
const CACHE_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), "LOF套利监控", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "lof_data_node.json");

try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch (_) {}

const state = {
  funds: [],
  updated: "",
  message: "等待刷新",
  sources: {},
  refreshing: false,
  lastFull: 0,
  lastFast: 0
};

const APP_URL = `http://${HOST}:${PORT}`;
const KNOWN_LISTED_LOF_CODES = new Set([
  // 天天基金代码库名称里没有写 LOF，但交易所场内代码确认为 LOF 的基金。
  "501018",
  "160644"
]);

function hasLofMarker(code, name = "", type = "") {
  return KNOWN_LISTED_LOF_CODES.has(String(code || "")) || /LOF/i.test(`${name || ""} ${type || ""}`);
}

function openBrowser() {
  if (process.env.LOF_NO_OPEN) return;
  const launchUrl = `${APP_URL}/?open=${Date.now()}`;
  if (process.platform === "win32") {
    const result = spawnSync(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", launchUrl],
      { windowsHide: true, stdio: "ignore", timeout: 5000 }
    );
    if (result.error || result.status !== 0) {
      spawnSync(
        "cmd.exe",
        ["/d", "/s", "/c", `start "" "${launchUrl}"`],
        { windowsHide: true, stdio: "ignore", timeout: 5000 }
      );
    }
    return;
  }
  exec(`open "${launchUrl}" || xdg-open "${launchUrl}"`);
}

async function existingServerIsAlive() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${APP_URL}/api/ping?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data && data.app === "lof-arbitrage-monitor";
    }
  } catch (_) {}
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${APP_URL}/?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const html = await res.text();
    return html.includes("LOF") && html.includes("api/data");
  } catch (_) {
    return false;
  }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (_) {
    // Cache is optional; data should still render when the sandbox or OS blocks this path.
  }
  saveFundConfig();
}

function configRecord(r) {
  return {
    code: r.code,
    name: r.name || "",
    group: r.group || classifyFund(r.name, r.note, r.code),
    group_name: groupName(r.group || classifyFund(r.name, r.note, r.code)),
    market: r.market || marketOf(r.code),
    market_name: r.market_name || (marketOf(r.code) === "SH" ? "上海" : "深圳"),
    price_date: r.price_date || "",
    price: r.price ?? null,
    change_pct: r.change_pct ?? null,
    volume: r.volume ?? null,
    amount: r.amount ?? null,
    nav: r.nav ?? null,
    nav_date: r.nav_date || "",
    premium: r.premium ?? null,
    apply_status: r.apply_status || "",
    redeem_status: r.redeem_status || "",
    apply_limit: r.apply_limit || "",
    apply_fee: r.apply_fee || "",
    redeem_fee: r.redeem_fee || "",
    trade_status_source: r.trade_status_source || "",
    source: r.source || "",
    note: r.note || "",
    user_added: Boolean(r.user_added)
  };
}

function saveFundConfig() {
  try {
    const funds = (state.funds || []).filter(isListedLofCandidate).map(configRecord);
    const data = {
      version: 1,
      app: "lof-arbitrage-monitor",
      updated: state.updated || nowText(),
      description: "场内 LOF 基金配置文件。换电脑时复制本文件到 LOF套利监控.exe 同目录即可。",
      funds
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (_) {}
}

function readFundConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    const rows = Array.isArray(data) ? data : data.funds;
    if (!Array.isArray(rows)) return [];
    return rows
      .map(r => ({ ...baseRecord(r.code, r.group || classifyFund(r.name, r.note, r.code), r.name), ...r }))
      .filter(isListedLofCandidate);
  } catch (_) {
    return [];
  }
}

function nowText() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTradingTime() {
  const d = new Date();
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = d.getHours() * 60 + d.getMinutes();
  return (minutes >= 9 * 60 + 15 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60);
}

function safeFloat(v) {
  if (v === null || v === undefined || v === "" || v === "-" || v === "--") return null;
  const n = Number(String(v).replace(/[,万元%]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function pctValue(v) {
  return safeFloat(v);
}

function formatQuoteDate(value) {
  const s = String(value || "").replace(/\D/g, "");
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return "";
}

function timestampDate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n * 1000);
  const p = x => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function codeOf(v) {
  const m = String(v || "").match(/\d{6}/g);
  return m ? m[m.length - 1] : "";
}

function marketOf(code) {
  return code.startsWith("5") ? "SH" : "SZ";
}

function groupName(group) {
  return {
    stock: "股票LOF",
    index: "指数LOF",
    qdii_europe_us: "欧美市场",
    qdii_asia: "亚洲市场"
  }[group] || group;
}

function baseRecord(code, group, name = "") {
  return {
    code,
    name,
    group,
    group_name: groupName(group),
    market: marketOf(code),
    market_name: marketOf(code) === "SH" ? "上海" : "深圳",
    price_date: "",
    price: null,
    change_pct: null,
    volume: null,
    amount: null,
    nav: null,
    nav_date: "",
    premium: null,
    apply_status: "",
    redeem_status: "",
    apply_fee: "",
    redeem_fee: "",
    source: ""
  };
}

function mergeRecord(dst, src) {
  const alwaysUpdate = new Set([
    "price", "price_date", "change_pct", "volume", "amount", "premium", "nav", "nav_date",
    "apply_status", "redeem_status", "apply_limit", "apply_fee", "redeem_fee", "trade_status_source"
  ]);
  for (const [key, value] of Object.entries(src)) {
    if (value === null || value === undefined || value === "" || value === "-" || value === "--") continue;
    if (dst[key] === null || dst[key] === undefined || dst[key] === "" || alwaysUpdate.has(key)) {
      dst[key] = value;
    }
  }
  dst.group_name = groupName(dst.group);
}

function calcPremium(r) {
  if (r.price !== null && r.nav !== null && r.nav !== 0) {
    r.premium = (r.price - r.nav) / r.nav * 100;
  }
}

function isListedLofCandidate(r) {
  return /^(16|50)\d{4}$/.test(String(r.code || "")) &&
    hasLofMarker(r.code, r.name, r.note);
}

function canCalculatePremium(r) {
  return r.price !== null &&
    r.nav !== null &&
    r.premium !== null &&
    Number.isFinite(Number(r.price)) &&
    Number.isFinite(Number(r.nav)) &&
    Number.isFinite(Number(r.premium)) &&
    Number(r.price) > 0 &&
    Number(r.nav) > 0;
}

async function getText(url, params = {}, referer = "") {
  const u = new URL(url);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
      "Accept": "application/json,text/javascript,*/*;q=0.1",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      ...(referer ? { Referer: referer } : {})
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

function parseJsonish(text) {
  const s = text.trim();
  if (s.startsWith("{") || s.startsWith("[")) return JSON.parse(s);
  const m = s.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
  if (m) return JSON.parse(m[1]);
  throw new Error("无法解析返回数据");
}

function pick(cell, names) {
  const lower = {};
  for (const [k, v] of Object.entries(cell)) lower[k.toLowerCase()] = v;
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(cell, n)) return cell[n];
    if (Object.prototype.hasOwnProperty.call(lower, n.toLowerCase())) return lower[n.toLowerCase()];
  }
  return null;
}

function parseJisiluRows(payload) {
  const rows = Array.isArray(payload) ? payload : (payload.rows || payload.data || []);
  return rows.map(r => r && r.cell && typeof r.cell === "object" ? r.cell : r).filter(Boolean);
}

function parseJisiluRecord(cell, group) {
  let code = codeOf(pick(cell, ["fund_id", "code", "symbol", "id"])) || codeOf(Object.values(cell).join(" "));
  if (!code) return null;
  let name = String(pick(cell, ["fund_nm", "fund_name", "name", "display_name"]) || "").replace(/<[^>]+>/g, "").trim();
  if (/^\d{6}$/.test(name)) name = "";
  const r = baseRecord(code, group, name);
  Object.assign(r, {
    price: safeFloat(pick(cell, ["price", "last_price", "now_price", "close"])),
    change_pct: pctValue(pick(cell, ["increase_rt", "price_increase_rt", "change_rt", "change_pct"])),
    volume: safeFloat(pick(cell, ["volume", "fund_volume"])),
    amount: safeFloat(pick(cell, ["amount", "money", "turnover"])),
    nav: safeFloat(pick(cell, ["fund_nav", "nav", "estimate_value", "unit_nav", "net_value"])),
    nav_date: String(pick(cell, ["nav_dt", "nav_date", "price_dt", "date"]) || ""),
    premium: pctValue(pick(cell, ["discount_rt", "premium_rt", "fund_premium_rt"])),
    apply_status: String(pick(cell, ["apply_status", "sg_status", "subscription_status"]) || ""),
    redeem_status: String(pick(cell, ["redeem_status", "sh_status", "redemption_status"]) || ""),
    source: "集思录"
  });
  calcPremium(r);
  return r;
}

function classifyFund(name, type, code) {
  const n = String(name || "").toUpperCase();
  const t = String(type || "").toUpperCase();
  const s = `${n} ${t}`;
  if (/QDII|全球|美国|欧洲|德国|法国|英国|标普|纳指|纳斯达克|日本|印度|越南|香港|亚洲|亚太|恒生|油气|原油|商品/.test(s)) {
    return /日本|印度|越南|香港|亚洲|亚太|恒生|港股/.test(s) && !/美国|欧洲|德国|法国|英国|标普|纳指|纳斯达克|全球|油气|原油/.test(s)
      ? "qdii_asia"
      : "qdii_europe_us";
  }
  if (/指数型/.test(t) || /指数|ETF联接/.test(t)) {
    return "index";
  }
  if (/指数|ETF联接/.test(n) && !/指数增强/.test(n)) {
    return "index";
  }
  return "stock";
}

async function fetchFundCodePool() {
  const text = await getText("https://fund.eastmoney.com/js/fundcode_search.js", {}, "https://fund.eastmoney.com/");
  const match = text.match(/\[\[.*\]\]/s);
  if (!match) return [[], "天天基金代码库未解析到数组"];
  const items = JSON.parse(match[0]);
  const byCode = new Map();
  for (const item of items) {
    const code = codeOf(item[0]);
    const name = String(item[2] || "");
    const type = String(item[3] || "");
    if (!/^(16|50)\d{4}$/.test(code)) continue;
    if (!hasLofMarker(code, name, type)) continue;
    const record = baseRecord(code, classifyFund(name, type, code), name);
    record.source = "天天基金代码库";
    record.note = type;
    if (!byCode.has(code)) {
      byCode.set(code, record);
    } else {
      const old = byCode.get(code);
      if (/后端/.test(old.name) && !/后端/.test(name)) byCode.set(code, record);
    }
  }
  return [[...byCode.values()], `天天基金代码库发现 ${byCode.size} 只 LOF`];
}

async function findLofCandidate(query) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, message: "请输入基金代码或名称" };
  const text = await getText("https://fund.eastmoney.com/js/fundcode_search.js", {}, "https://fund.eastmoney.com/");
  const match = text.match(/\[\[.*\]\]/s);
  if (!match) return { ok: false, message: "未能读取基金代码库" };
  const items = JSON.parse(match[0]);
  const qLower = q.toLowerCase();
  const exact = [];
  const fuzzy = [];
  for (const item of items) {
    const code = codeOf(item[0]);
    const name = String(item[2] || "");
    const type = String(item[3] || "");
    const hay = `${code} ${name} ${type}`.toLowerCase();
    const isMatch = code === q || name === q || hay.includes(qLower);
    if (!isMatch) continue;
    const isLof = /^(16|50)\d{4}$/.test(code) && hasLofMarker(code, name, type);
    const rec = baseRecord(code, classifyFund(name, type, code), name);
    rec.source = "手动搜索添加";
    rec.note = type;
    const hit = { isLof, record: rec, type };
    if (code === q || name === q) exact.push(hit);
    else fuzzy.push(hit);
  }
  const candidates = exact.concat(fuzzy);
  const lof = candidates.find(x => x.isLof);
  if (lof) return { ok: true, record: lof.record, message: `已识别为 LOF：${lof.record.code} ${lof.record.name}` };
  if (candidates.length) return { ok: false, message: "找到了基金，但不符合 LOF 场内套利基金条件" };
  return { ok: false, message: "基金代码库里没有找到匹配项" };
}

async function searchAndAdd(query) {
  const found = await findLofCandidate(query);
  if (!found.ok) return found;
  const rec = found.record;
  rec.user_added = true;
  const existing = state.funds.find(x => x.code === rec.code);
  if (existing) {
    const nav = await fetchOneNav(existing.code);
    if (nav) mergeRecord(existing, nav);
    const [quotes] = await fetchQuotes([existing.code]);
    if (quotes[existing.code]) mergeRecord(existing, quotes[existing.code]);
    calcPremium(existing);
    state.updated = nowText();
    saveCache();
    return { ok: true, added: false, record: existing, message: "列表中已经有这只 LOF，已更新它的数据" };
  }
  const nav = await fetchOneNav(rec.code);
  if (nav) mergeRecord(rec, nav);
  const [quotes] = await fetchQuotes([rec.code]);
  if (quotes[rec.code]) mergeRecord(rec, quotes[rec.code]);
  calcPremium(rec);
  rec.market_name = rec.market === "SH" ? "上海" : "深圳";
  state.funds.push(rec);
  state.updated = nowText();
  state.message = `已手动添加 ${rec.code} ${rec.name}`;
  saveCache();
  return { ok: true, added: true, record: rec, message: state.message };
}

async function fetchJisiluGroup(group) {
  const t = Date.now();
  const key = group.startsWith("qdii") ? "qdii" : group;
  const urls = {
    stock: [["https://www.jisilu.cn/data/lof/stock_lof_list/", { "___jsl": "LST___", t }]],
    index: [["https://www.jisilu.cn/data/lof/index_lof_list/", { "___jsl": "LST___", t }]],
    qdii: [["https://www.jisilu.cn/data/qdii/qdii_list/", { "___jsl": "LST___", t }]]
  }[key];
  const errors = [];
  for (const [url, params] of urls) {
    try {
      const payload = parseJsonish(await getText(url, params, "https://www.jisilu.cn/data/lof/"));
      const rows = parseJisiluRows(payload).map(c => parseJisiluRecord(c, group)).filter(Boolean);
      if (rows.length) return [rows, `集思录返回 ${rows.length} 条`];
    } catch (e) {
      errors.push(e.message);
    }
  }
  return [[], `集思录接口暂不可用：${errors.slice(0, 2).join(" | ")}`];
}

function classifyFallback(name, code) {
  return classifyFund(name, "", code);
}

async function fetchEastmoneyNav() {
  const text = await getText("https://fund.eastmoney.com/data/rankhandler.aspx", {
    op: "ph", dt: "kf", ft: "lof", rs: "", gs: "0", sc: "zzf", st: "desc",
    sd: "2020-01-01", ed: new Date().toISOString().slice(0, 10), qdii: "",
    tabSubtype: ",,,,,", pi: 1, pn: 2000, dx: 1, v: Math.random()
  }, "https://fund.eastmoney.com/LOF_dwjz.html");
  const m = text.match(/datas\s*:\s*(\[[\s\S]*?\])\s*,\s*allRecords/);
  if (!m) return [[], "天天基金净值列表未解析到数据"];
  const rows = JSON.parse(m[1]).map(line => {
    const p = line.split(",");
    const code = codeOf(p[0]);
    if (!/^(16|50)\d{4}$/.test(code)) return null;
    const r = baseRecord(code, classifyFallback(p[1], code), p[1]);
    r.nav_date = p[3] || "";
    r.nav = safeFloat(p[4]);
    r.apply_status = p[11] || "";
    r.redeem_status = p[12] || "";
    r.apply_fee = p[13] || "";
    r.source = "天天基金";
    return r;
  }).filter(Boolean);
  return [rows, `天天基金返回 ${rows.length} 条`];
}

async function fetchQuotes(codes) {
  const out = {};
  for (let i = 0; i < codes.length; i += 80) {
    const batch = codes.slice(i, i + 80);
    try {
      const secids = batch.map(c => `${marketOf(c) === "SH" ? "1" : "0"}.${c}`).join(",");
      const payload = parseJsonish(await getText("https://push2.eastmoney.com/api/qt/ulist.np/get", {
        fltt: 2, invt: 2, fields: "f12,f13,f14,f2,f3,f5,f6,f8,f124,f297", secids, _: Date.now()
      }, "https://quote.eastmoney.com/"));
      for (const q of (((payload || {}).data || {}).diff || [])) {
        const code = codeOf(q.f12);
        const amount = safeFloat(q.f6);
        out[code] = {
          name: String(q.f14 || ""),
          market: String(q.f13) === "1" ? "SH" : "SZ",
          price_date: formatQuoteDate(q.f297) || timestampDate(q.f124),
          price: safeFloat(q.f2),
          change_pct: safeFloat(q.f3),
          volume: safeFloat(q.f5),
          amount: amount === null ? null : amount / 10000
        };
      }
    } catch (_) {}
  }
  const [sinaQuotes, sinaMsg] = await fetchSinaQuotes(codes.filter(code => !out[code]));
  Object.assign(out, sinaQuotes);
  return [out, `行情返回 ${Object.keys(out).length}/${codes.length} 条；${sinaMsg}`];
}

async function fetchSinaQuotes(codes) {
  const out = {};
  for (let i = 0; i < codes.length; i += 120) {
    const batch = codes.slice(i, i + 120);
    if (!batch.length) continue;
    try {
      const symbols = batch.map(code => `${marketOf(code).toLowerCase()}${code}`).join(",");
      const text = await getText(`https://hq.sinajs.cn/list=${symbols}`, {}, "https://finance.sina.com.cn/");
      const re = /var hq_str_(s[hz]\d{6})="([^"]*)";/g;
      let m;
      while ((m = re.exec(text))) {
        const symbol = m[1];
        const code = symbol.slice(2);
        const p = m[2].split(",");
        const prev = safeFloat(p[2]);
        const price = safeFloat(p[3]);
        if (!price || price <= 0) continue;
        out[code] = {
          price_date: p[30] || "",
          price,
          change_pct: prev ? (price - prev) / prev * 100 : null,
          volume: safeFloat(p[8]),
          amount: safeFloat(p[9]) === null ? null : safeFloat(p[9]) / 10000
        };
      }
    } catch (_) {}
  }
  return [out, `新浪行情返回 ${Object.keys(out).length}/${codes.length} 条`];
}

async function fetchOneNav(code) {
  let best = null;
  function keepNewest(candidate) {
    if (!candidate || candidate.nav === null) return;
    if (!best || String(candidate.nav_date || "") > String(best.nav_date || "")) best = candidate;
  }
  try {
    const text = await getText(`https://fundgz.1234567.com.cn/js/${code}.js`, {}, `https://fund.eastmoney.com/${code}.html`);
    const m = text.match(/jsonpgz\(([\s\S]*)\)\s*;?/);
    if (m && m[1].trim()) {
      const data = JSON.parse(m[1]);
      keepNewest({
        name: String(data.name || ""),
        nav: safeFloat(data.dwjz),
        nav_date: String(data.jzrq || ""),
        source: "天天基金净值"
      });
    }
  } catch (_) {}
  try {
    const text = await getText(`https://fund.eastmoney.com/pingzhongdata/${code}.js`, { v: Date.now() }, `https://fund.eastmoney.com/${code}.html`);
    const name = (text.match(/var\s+fS_name\s*=\s*"([^"]*)"/) || [])[1] || "";
    const navMatch = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    if (!navMatch) return null;
    let last = {};
    try {
      const rows = JSON.parse(navMatch[1]);
      last = rows[rows.length - 1] || {};
    } catch (_) {
      const points = [...navMatch[1].matchAll(/\{\s*x\s*:\s*(\d+)\s*,\s*y\s*:\s*([0-9.]+)/g)];
      const point = points[points.length - 1];
      if (point) last = { x: Number(point[1]), y: Number(point[2]) };
    }
    keepNewest({
      name,
      nav: safeFloat(last.y),
      // Eastmoney timestamps represent China-market dates at local midnight.
      nav_date: last.x ? new Date(Number(last.x) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) : "",
      source: "天天基金正式净值"
    });
  } catch (_) {}
  return best;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanStatus(value) {
  return String(value || "")
    .replace(/[：:]/g, "")
    .replace(/--/g, "")
    .trim();
}

function parseTradeStatusHtml(html, code) {
  const text = htmlToText(html);
  const record = { code, trade_status_source: "天天基金档案" };
  const tableMatch = text.match(/交易状态\s+申购状态\s+(\S+)\s+赎回状态\s+(\S+)/);
  if (tableMatch) {
    record.apply_status = cleanStatus(tableMatch[1]);
    record.redeem_status = cleanStatus(tableMatch[2]);
  }
  const summaryMatch = text.match(/交易状态[：:]\s*(\S+)(?:\s+（[^）]*）)?\s+(\S*赎回)/);
  if (summaryMatch) {
    if (!record.apply_status) record.apply_status = cleanStatus(summaryMatch[1]);
    if (!record.redeem_status) record.redeem_status = cleanStatus(summaryMatch[2]);
  }
  const limitMatch = text.match(/日累计申购限额\s+(\S+)/);
  if (limitMatch) record.apply_limit = cleanStatus(limitMatch[1]);
  const feeMatch = text.match(/购买手续费[：:]?\s+([0-9.]+%)/);
  if (feeMatch) record.apply_fee = cleanStatus(feeMatch[1]);
  return record.apply_status || record.redeem_status || record.apply_limit ? record : null;
}

async function fetchOneTradeStatus(code) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const html = await getText(
        `https://fundf10.eastmoney.com/jjfl_${code}.html`,
        {},
        `https://fund.eastmoney.com/${code}.html`
      );
      const status = parseTradeStatusHtml(html, code);
      if (status) return status;
    } catch (_) {}
    if (attempt < 2) await sleep(250 + attempt * 500);
  }
  return null;
}

async function enrichNav(records) {
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < records.length) {
      const rec = records[cursor++];
      const nav = await fetchOneNav(rec.code);
      if (nav) {
        mergeRecord(rec, nav);
        done++;
      }
    }
  }
  await Promise.all(Array.from({ length: 24 }, worker));
  return [`天天基金单基金净值补齐 ${done}/${records.length} 条`, done];
}

async function enrichTradeStatus(records) {
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < records.length) {
      const rec = records[cursor++];
      const status = await fetchOneTradeStatus(rec.code);
      if (status) {
        mergeRecord(rec, status);
        done++;
      }
      await sleep(100);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return [`天天基金交易状态补齐 ${done}/${records.length} 条`, done];
}

function splitQdiiRegions(records) {
  for (const r of records) {
    if (!r.group.startsWith("qdii")) continue;
    if (/日本|印度|越南|香港|中国|亚洲|亚太|恒生|港股/.test(r.name) && !/美国|欧洲|德国|法国|英国|标普|纳指|纳斯达克|全球|油气|原油/.test(r.name)) {
      r.group = "qdii_asia";
    } else {
      r.group = "qdii_europe_us";
    }
    r.group_name = groupName(r.group);
  }
}

async function fullRefresh() {
  if (state.refreshing) return { ok: true, message: "正在刷新，请稍候" };
  state.refreshing = true;
  const sources = {};
  const merged = {};
  try {
    const [poolRows, poolMsg] = await fetchFundCodePool();
    sources["完整LOF基金池"] = { ok: poolRows.length > 0, message: poolMsg, count: poolRows.length };
    for (const row of poolRows) {
      merged[row.code] = row;
    }

    for (const group of ["stock", "index", "qdii_europe_us", "qdii_asia"]) {
      const [rows, msg] = await fetchJisiluGroup(group);
      sources[`集思录补充-${groupName(group)}`] = { ok: rows.length > 0, message: msg, count: rows.length };
      for (const row of rows) {
        if (!merged[row.code]) merged[row.code] = baseRecord(row.code, group, row.name);
        mergeRecord(merged[row.code], row);
      }
    }
    if (!Object.keys(merged).length) {
      const [rows, msg] = await fetchEastmoneyNav();
      sources["备用数据"] = { ok: rows.length > 0, message: msg, count: rows.length };
      for (const row of rows) merged[row.code] = row;
    }
    const configuredRows = readFundConfig();
    sources["基金配置文件"] = { ok: configuredRows.length > 0, message: `读取 ${configuredRows.length} 只已配置基金`, count: configuredRows.length };
    for (const row of configuredRows) {
      if (!merged[row.code]) merged[row.code] = row;
      else mergeRecord(merged[row.code], row);
    }
    if (!Object.keys(merged).length) throw new Error("没有抓到数据，可能是网络或数据源临时限制。");
    const recordsBeforeQuotes = Object.values(merged);
    const [navMsg, navCount] = await enrichNav(recordsBeforeQuotes);
    sources["单位净值"] = { ok: navCount > 0, message: navMsg, count: navCount };
    const [tradeMsg, tradeCount] = await enrichTradeStatus(recordsBeforeQuotes);
    sources["申购赎回状态"] = { ok: tradeCount > 0, message: tradeMsg, count: tradeCount };

    const [quotes, quoteMsg] = await fetchQuotes(Object.keys(merged));
    sources["场内行情"] = { ok: Object.keys(quotes).length > 0, message: quoteMsg, count: Object.keys(quotes).length };
    for (const [code, quote] of Object.entries(quotes)) if (merged[code]) mergeRecord(merged[code], quote);
    const records = Object.values(merged);
    splitQdiiRegions(records);
    for (const r of records) {
      calcPremium(r);
      r.market_name = r.market === "SH" ? "上海" : "深圳";
    }
    const lofRecords = records.filter(isListedLofCandidate);
    lofRecords.sort((a, b) => (b.premium ?? -999) - (a.premium ?? -999));
    state.funds = lofRecords;
    state.updated = nowText();
    const calculable = lofRecords.filter(canCalculatePremium).length;
    state.message = `已更新 ${lofRecords.length} 只可参与套利观察的场内 LOF，其中 ${calculable} 只可计算溢价率`;
    state.sources = sources;
    state.lastFull = Date.now();
    state.lastFast = Date.now();
    saveCache();
    return { ok: true, count: records.length, sources };
  } catch (e) {
    state.message = e.message;
    return { ok: false, message: e.message, sources };
  } finally {
    state.refreshing = false;
  }
}

async function fastRefresh() {
  if (!state.funds.length) return await fullRefresh();
  const [quotes, quoteMsg] = await fetchQuotes(state.funds.map(r => r.code));
  for (const r of state.funds) {
    if (quotes[r.code]) mergeRecord(r, quotes[r.code]);
    calcPremium(r);
  }
  state.updated = nowText();
  if (Object.keys(quotes).length) state.message = `快速刷新完成，行情 ${Object.keys(quotes).length} 条`;
  state.sources["场内行情"] = { ok: Object.keys(quotes).length > 0, message: quoteMsg, count: Object.keys(quotes).length };
  state.lastFast = Date.now();
  saveCache();
  return { ok: true, count: state.funds.length, quote_count: Object.keys(quotes).length };
}

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function sendCsv(res) {
  const cols = ["group_name", "code", "name", "market_name", "price_date", "price", "change_pct", "nav", "nav_date", "premium", "amount", "volume", "apply_status", "redeem_status", "source"];
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...state.funds.map(r => cols.map(c => esc(r[c])).join(","))].join("\r\n");
  res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=lof_arbitrage.csv" });
  res.end("\ufeff" + csv);
}

try {
  if (fs.existsSync(CACHE_FILE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    state.funds = (cached.funds || []).filter(isListedLofCandidate);
    state.updated = cached.updated || "";
    state.message = cached.message || "已读取本地缓存";
    state.sources = cached.sources || {};
  }
  const configured = readFundConfig();
  if (configured.length) {
    state.funds = configured;
    state.updated = nowText();
    state.message = `已读取基金配置文件：${configured.length} 只`;
  }
} catch (_) {}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(APP_DIR, "lof_viewer.html"), "utf8"));
    } else if (url.pathname === "/api/ping") {
      sendJson(res, { ok: true, app: "lof-arbitrage-monitor", updated: state.updated });
    } else if (url.pathname === "/api/data") {
      if (!state.funds.length) await fullRefresh();
      sendJson(res, { ok: true, funds: state.funds, updated: state.updated, message: state.message, sources: state.sources, refreshing: state.refreshing, trading: isTradingTime() });
    } else if (url.pathname === "/api/refresh") {
      fullRefresh();
      sendJson(res, { ok: true, message: "已开始全量刷新" });
    } else if (url.pathname === "/api/refresh_fast") {
      sendJson(res, await fastRefresh());
    } else if (url.pathname === "/api/search_add") {
      sendJson(res, await searchAndAdd(url.searchParams.get("q")));
    } else if (url.pathname === "/api/shutdown") {
      sendJson(res, { ok: true, message: "程序即将退出" });
      setTimeout(() => process.exit(0), 300);
    } else if (url.pathname === "/api/export.csv") {
      sendCsv(res);
    } else {
      sendJson(res, { ok: false, message: "Not found" }, 404);
    }
  } catch (e) {
    sendJson(res, { ok: false, message: e.message }, 500);
  }
});

server.on("error", async err => {
  if (err && err.code === "EADDRINUSE") {
    if (await existingServerIsAlive()) {
      openBrowser();
      process.exit(0);
    }
  }
  process.exit(1);
});

(async () => {
  if (await existingServerIsAlive()) {
    openBrowser();
    process.exit(0);
  }
  server.listen(PORT, HOST, () => {
    console.log(`LOF套利监控已启动：${APP_URL}`);
    openBrowser();
  });
})();

setInterval(() => {
  const now = Date.now();
  if (!state.funds.length || now - state.lastFull > 30 * 60 * 1000) fullRefresh();
  else if (now - state.lastFast > 30 * 1000) fastRefresh();
}, 5000);
