from __future__ import annotations

import csv
import io
import json
import math
import os
import random
import re
import sys
import threading
import time
import webbrowser
from datetime import datetime, time as dtime
from pathlib import Path
from typing import Any

import requests
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response

APP_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
WORK_DIR = Path(os.getenv("LOCALAPPDATA", Path.home())) / "LOF套利监控"
CACHE_DIR = WORK_DIR / "cache"
try:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    CACHE_DIR = APP_DIR / "cache"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

CACHE_FILE = CACHE_DIR / "lof_data.json"
HOST = "127.0.0.1"
PORT = 8787

FULL_REFRESH_SECONDS = 60 * 30
FAST_REFRESH_SECONDS = 30

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
        ),
        "Accept": "application/json,text/javascript,*/*;q=0.1",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
    }
)

app = FastAPI(title="LOF套利监控")
LOCK = threading.RLock()
STATE: dict[str, Any] = {
    "funds": [],
    "updated": "",
    "message": "等待刷新",
    "sources": {},
    "refreshing": False,
    "last_full": 0.0,
    "last_fast": 0.0,
}


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def is_trading_time() -> bool:
    now = datetime.now()
    if now.weekday() >= 5:
        return False
    t = now.time()
    return dtime(9, 15) <= t <= dtime(11, 30) or dtime(13, 0) <= t <= dtime(15, 0)


def text_of(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def safe_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    s = str(value).strip()
    if not s or s in {"-", "--", "---", "null", "None", "nan"}:
        return None
    s = s.replace(",", "").replace("%", "").replace("元", "").replace("万", "")
    try:
        n = float(s)
        return n if math.isfinite(n) else None
    except ValueError:
        return None


def pct_value(value: Any) -> float | None:
    return safe_float(value)


def normalize_code(value: Any) -> str:
    digits = re.sub(r"\D", "", text_of(value))
    return digits[-6:].zfill(6) if digits else ""


def market_of(code: str) -> str:
    return "SH" if code.startswith("5") else "SZ"


def secid(code: str) -> str:
    return ("1." if market_of(code) == "SH" else "0.") + code


def base_record(code: str, group: str = "", name: str = "") -> dict[str, Any]:
    return {
        "code": code,
        "name": name,
        "group": group or "stock",
        "group_name": group_name(group or "stock"),
        "market": market_of(code),
        "price": None,
        "change_pct": None,
        "volume": None,
        "amount": None,
        "nav": None,
        "nav_date": "",
        "premium": None,
        "apply_status": "",
        "redeem_status": "",
        "apply_fee": "",
        "redeem_fee": "",
        "source": "",
        "note": "",
    }


def group_name(group: str) -> str:
    return {
        "stock": "股票LOF",
        "index": "指数LOF",
        "qdii_europe_us": "欧美市场",
        "qdii_asia": "亚洲市场",
    }.get(group, group)


def request_json(url: str, params: dict[str, Any] | None = None, referer: str = "") -> Any:
    headers = {"Referer": referer} if referer else {}
    r = SESSION.get(url, params=params, headers=headers, timeout=18)
    r.raise_for_status()
    text = r.text.strip()
    if text.startswith("{") or text.startswith("["):
        return r.json()
    m = re.search(r"^[^(]*\(([\s\S]*)\)\s*;?\s*$", text)
    if m:
        return json.loads(m.group(1))
    return json.loads(text)


def pick(cell: dict[str, Any], *names: str) -> Any:
    lower = {str(k).lower(): v for k, v in cell.items()}
    for name in names:
        if name in cell:
            return cell[name]
        if name.lower() in lower:
            return lower[name.lower()]
    return None


def rows_from_jisilu_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        rows = payload.get("rows") or payload.get("data") or []
    else:
        rows = payload or []
    out = []
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("cell"), dict):
            out.append(row["cell"])
        elif isinstance(row, dict):
            out.append(row)
    return out


def parse_jisilu_record(cell: dict[str, Any], group: str) -> dict[str, Any] | None:
    code = normalize_code(
        pick(cell, "fund_id", "fund_nm", "code", "symbol", "fundA_id", "id")
    )
    if not code:
        # Some Jisilu rows store code in a link-like field.
        joined = " ".join(text_of(v) for v in cell.values())
        m = re.search(r"\b(16\d{4}|50\d{4})\b", joined)
        code = m.group(1) if m else ""
    if not code:
        return None

    name = text_of(pick(cell, "fund_nm", "fund_name", "name", "display_name"))
    name = re.sub(r"<[^>]+>", "", name).strip()
    if re.fullmatch(r"\d{6}", name):
        name = ""

    record = base_record(code, group, name)
    record.update(
        {
            "price": safe_float(pick(cell, "price", "last_price", "now_price", "close")),
            "change_pct": pct_value(pick(cell, "increase_rt", "price_increase_rt", "change_rt", "change_pct")),
            "volume": safe_float(pick(cell, "volume", "fund_volume")),
            "amount": safe_float(pick(cell, "amount", "money", "turnover")),
            "nav": safe_float(pick(cell, "fund_nav", "nav", "estimate_value", "unit_nav", "net_value")),
            "nav_date": text_of(pick(cell, "nav_dt", "nav_date", "price_dt", "date")),
            "premium": pct_value(pick(cell, "discount_rt", "premium_rt", "fund_premium_rt")),
            "apply_status": text_of(pick(cell, "apply_status", "sg_status", "subscription_status")),
            "redeem_status": text_of(pick(cell, "redeem_status", "sh_status", "redemption_status")),
            "apply_fee": text_of(pick(cell, "apply_fee", "subscription_fee")),
            "redeem_fee": text_of(pick(cell, "redeem_fee", "redemption_fee")),
            "source": "集思录",
        }
    )
    if record["premium"] is None:
        calculate_premium(record)
    return record


def fetch_jisilu_group(group: str) -> tuple[list[dict[str, Any]], str]:
    t = int(time.time() * 1000)
    candidates = {
        "stock": [
            ("https://www.jisilu.cn/data/lof/stock_lof_list/", {"___jsl": "LST___", "t": t}),
            ("https://www.jisilu.cn/data/lof/stock_lof_list/", {"rp": 200, "page": 1, "t": t}),
        ],
        "index": [
            ("https://www.jisilu.cn/data/lof/index_lof_list/", {"___jsl": "LST___", "t": t}),
            ("https://www.jisilu.cn/data/lof/index_lof_list/", {"rp": 200, "page": 1, "t": t}),
        ],
        "qdii": [
            ("https://www.jisilu.cn/data/qdii/qdii_list/", {"___jsl": "LST___", "t": t}),
            ("https://www.jisilu.cn/data/qdii/qdii_list/", {"rp": 200, "page": 1, "t": t}),
        ],
    }
    key = "qdii" if group.startswith("qdii") else group
    errors: list[str] = []
    for url, params in candidates[key]:
        try:
            payload = request_json(url, params=params, referer="https://www.jisilu.cn/data/lof/")
            parsed = []
            for cell in rows_from_jisilu_payload(payload):
                rec = parse_jisilu_record(cell, group)
                if rec:
                    parsed.append(rec)
            if parsed:
                return parsed, f"集思录返回 {len(parsed)} 条"
        except Exception as exc:
            errors.append(str(exc))
    return [], "集思录接口暂不可用：" + " | ".join(errors[:2])


def classify_fallback_group(name: str, code: str) -> str:
    s = name.upper()
    qdii_words = ["QDII", "全球", "美国", "标普", "纳指", "纳斯达克", "德国", "法国", "日本", "印度", "越南", "香港"]
    if any(w in s for w in qdii_words):
        return "qdii_asia" if any(w in s for w in ["日本", "印度", "越南", "香港", "亚洲"]) else "qdii_europe_us"
    if any(w in s for w in ["指数", "中证", "沪深", "上证", "创业", "恒生", "纳指", "标普"]):
        return "index"
    if code.startswith("16") or code.startswith("50"):
        return "stock"
    return "stock"


def fetch_eastmoney_lof_nav() -> tuple[list[dict[str, Any]], str]:
    params = {
        "op": "ph",
        "dt": "kf",
        "ft": "lof",
        "rs": "",
        "gs": "0",
        "sc": "zzf",
        "st": "desc",
        "sd": "2020-01-01",
        "ed": datetime.now().strftime("%Y-%m-%d"),
        "qdii": "",
        "tabSubtype": ",,,,,",
        "pi": 1,
        "pn": 2000,
        "dx": 1,
        "v": random.random(),
    }
    text = SESSION.get(
        "https://fund.eastmoney.com/data/rankhandler.aspx",
        params=params,
        headers={"Referer": "https://fund.eastmoney.com/LOF_dwjz.html"},
        timeout=18,
    ).text
    m = re.search(r"datas\s*:\s*(\[[\s\S]*?\])\s*,\s*allRecords", text)
    if not m:
        return [], "天天基金净值列表未解析到数据"
    items = json.loads(m.group(1))
    records = []
    for line in items:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        code = normalize_code(parts[0])
        name = parts[1]
        if not re.fullmatch(r"(16\d{4}|50\d{4})", code):
            continue
        group = classify_fallback_group(name, code)
        rec = base_record(code, group, name)
        rec.update(
            {
                "nav_date": parts[3] if len(parts) > 3 else "",
                "nav": safe_float(parts[4]) if len(parts) > 4 else None,
                "apply_status": parts[11] if len(parts) > 11 else "",
                "redeem_status": parts[12] if len(parts) > 12 else "",
                "apply_fee": parts[13] if len(parts) > 13 else "",
                "source": "天天基金",
            }
        )
        records.append(rec)
    return records, f"天天基金返回 {len(records)} 条"


def fetch_quotes(codes: list[str]) -> tuple[dict[str, dict[str, Any]], str]:
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(codes), 80):
        batch = codes[i : i + 80]
        params = {
            "fltt": 2,
            "invt": 2,
            "fields": "f12,f13,f14,f2,f3,f5,f6,f8,f124",
            "secids": ",".join(secid(c) for c in batch),
            "_": int(time.time() * 1000),
        }
        try:
            payload = request_json(
                "https://push2.eastmoney.com/api/qt/ulist.np/get",
                params=params,
                referer="https://quote.eastmoney.com/",
            )
            for q in ((payload or {}).get("data") or {}).get("diff") or []:
                code = normalize_code(q.get("f12"))
                price = safe_float(q.get("f2"))
                out[code] = {
                    "name": text_of(q.get("f14")),
                    "market": "SH" if text_of(q.get("f13")) == "1" else "SZ",
                    "price": price,
                    "change_pct": safe_float(q.get("f3")),
                    "volume": safe_float(q.get("f5")),
                    "amount": (safe_float(q.get("f6")) / 10000) if safe_float(q.get("f6")) is not None else None,
                }
        except Exception:
            continue
    return out, f"行情返回 {len(out)}/{len(codes)} 条"


def merge_record(dst: dict[str, Any], src: dict[str, Any]) -> None:
    for key, value in src.items():
        if value in (None, "", "-", "--", "---"):
            continue
        if dst.get(key) in (None, "", "-", "--", "---") or key in {"price", "change_pct", "volume", "amount", "premium"}:
            dst[key] = value
    dst["group_name"] = group_name(dst["group"])


def calculate_premium(record: dict[str, Any]) -> None:
    price = safe_float(record.get("price"))
    nav = safe_float(record.get("nav"))
    if price is not None and nav not in (None, 0):
        record["premium"] = (price - nav) / nav * 100


def split_qdii_regions(records: list[dict[str, Any]]) -> None:
    asia_words = ["日本", "印度", "越南", "香港", "中国", "亚洲", "亚太", "恒生", "港股"]
    eu_us_words = ["美国", "欧洲", "德国", "法国", "英国", "标普", "纳指", "纳斯达克", "全球", "油气", "原油"]
    for rec in records:
        if not rec["group"].startswith("qdii"):
            continue
        name = rec.get("name", "")
        if any(w in name for w in asia_words) and not any(w in name for w in eu_us_words):
            rec["group"] = "qdii_asia"
        else:
            rec["group"] = "qdii_europe_us"
        rec["group_name"] = group_name(rec["group"])


def full_refresh() -> dict[str, Any]:
    with LOCK:
        if STATE["refreshing"]:
            return {"ok": True, "message": "正在刷新，请稍候"}
        STATE["refreshing"] = True

    sources: dict[str, Any] = {}
    merged: dict[str, dict[str, Any]] = {}
    try:
        for group in ["stock", "index", "qdii_europe_us", "qdii_asia"]:
            rows, msg = fetch_jisilu_group(group)
            sources[group_name(group)] = {"ok": bool(rows), "message": msg, "count": len(rows)}
            for row in rows:
                code = row["code"]
                if code not in merged:
                    merged[code] = base_record(code, group, row.get("name", ""))
                merge_record(merged[code], row)

        if not merged:
            rows, msg = fetch_eastmoney_lof_nav()
            sources["备用数据"] = {"ok": bool(rows), "message": msg, "count": len(rows)}
            for row in rows:
                merged[row["code"]] = row

        if not merged:
            raise RuntimeError("没有抓到数据，可能是网络或数据源临时限制。")

        quotes, quote_msg = fetch_quotes(list(merged))
        sources["场内行情"] = {"ok": bool(quotes), "message": quote_msg, "count": len(quotes)}
        for code, quote in quotes.items():
            if code in merged:
                merge_record(merged[code], quote)

        records = list(merged.values())
        split_qdii_regions(records)
        for rec in records:
            calculate_premium(rec)
            rec["market_name"] = "上海" if rec["market"] == "SH" else "深圳"

        records.sort(
            key=lambda r: (
                {"stock": 0, "index": 1, "qdii_europe_us": 2, "qdii_asia": 3}.get(r["group"], 9),
                r["premium"] is None,
                -(r["premium"] or -999),
            )
        )
        with LOCK:
            STATE.update(
                {
                    "funds": records,
                    "updated": now_text(),
                    "message": f"已更新 {len(records)} 只基金",
                    "sources": sources,
                    "last_full": time.time(),
                    "last_fast": time.time(),
                }
            )
            save_cache()
        return {"ok": True, "count": len(records), "sources": sources}
    except Exception as exc:
        with LOCK:
            STATE["message"] = str(exc)
        return {"ok": False, "message": str(exc), "sources": sources}
    finally:
        with LOCK:
            STATE["refreshing"] = False


def fast_refresh() -> dict[str, Any]:
    with LOCK:
        records = [dict(r) for r in STATE["funds"]]
    if not records:
        return full_refresh()
    quotes, quote_msg = fetch_quotes([r["code"] for r in records])
    by_code = {r["code"]: r for r in records}
    for code, quote in quotes.items():
        if code in by_code:
            merge_record(by_code[code], quote)
    for rec in records:
        calculate_premium(rec)
    with LOCK:
        STATE["funds"] = records
        STATE["updated"] = now_text()
        STATE["message"] = f"快速刷新完成，行情 {len(quotes)} 条"
        STATE["sources"]["场内行情"] = {"ok": bool(quotes), "message": quote_msg, "count": len(quotes)}
        STATE["last_fast"] = time.time()
        save_cache()
    return {"ok": True, "count": len(records), "quote_count": len(quotes)}


def save_cache() -> None:
    data = {
        "funds": STATE["funds"],
        "updated": STATE["updated"],
        "message": STATE["message"],
        "sources": STATE["sources"],
    }
    try:
        CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def load_cache() -> None:
    if not CACHE_FILE.exists():
        return
    try:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        with LOCK:
            STATE["funds"] = data.get("funds", [])
            STATE["updated"] = data.get("updated", "")
            STATE["message"] = data.get("message", "已读取本地缓存")
            STATE["sources"] = data.get("sources", {})
    except Exception:
        pass


def scheduler() -> None:
    while True:
        try:
            now = time.time()
            if not STATE["funds"] or now - STATE["last_full"] > FULL_REFRESH_SECONDS:
                full_refresh()
            elif now - STATE["last_fast"] > FAST_REFRESH_SECONDS:
                fast_refresh()
        except Exception:
            pass
        time.sleep(5)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(APP_DIR / "lof_viewer.html")


@app.get("/api/data")
def api_data() -> JSONResponse:
    if not STATE["funds"]:
        result = full_refresh()
        if not result.get("ok") and not STATE["funds"]:
            return JSONResponse({"ok": False, **result, "funds": []}, status_code=503)
    with LOCK:
        payload = {
            "ok": True,
            "funds": STATE["funds"],
            "updated": STATE["updated"],
            "message": STATE["message"],
            "sources": STATE["sources"],
            "refreshing": STATE["refreshing"],
            "trading": is_trading_time(),
        }
    return JSONResponse(payload)


@app.get("/api/refresh")
def api_refresh() -> dict[str, Any]:
    threading.Thread(target=full_refresh, daemon=True).start()
    return {"ok": True, "message": "已开始全量刷新"}


@app.get("/api/refresh_fast")
def api_refresh_fast() -> dict[str, Any]:
    return fast_refresh()


@app.get("/api/export.csv")
def api_export() -> Response:
    columns = [
        "group_name",
        "code",
        "name",
        "market_name",
        "price",
        "change_pct",
        "nav",
        "nav_date",
        "premium",
        "amount",
        "volume",
        "apply_status",
        "redeem_status",
        "source",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(STATE["funds"])
    return Response(
        buf.getvalue().encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=lof_arbitrage.csv"},
    )


def main() -> None:
    load_cache()
    threading.Thread(target=scheduler, daemon=True).start()
    threading.Timer(1.0, lambda: webbrowser.open(f"http://{HOST}:{PORT}")).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
