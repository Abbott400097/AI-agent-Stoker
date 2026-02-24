#!/usr/bin/env python3
import json
import sys
from datetime import datetime


def main():
    raw = (sys.stdin.read() or "{}").strip()
    payload = json.loads(raw)
    symbol = str(payload.get("symbol", "600519.SH")).upper()

    try:
        import akshare as ak  # type: ignore
    except Exception as e:
        emit({"ok": False, "error": f"akshare_import_failed:{e}"})
        return 0

    code = symbol.split(".")[0]
    try:
        df = ak.stock_zh_a_hist_min_em(symbol=code, period="1", adjust="")
    except Exception as e:
        emit({"ok": False, "error": f"akshare_fetch_failed:{e}", "symbol": symbol, "code": code})
        return 0

    if df is None or getattr(df, "empty", True):
        emit({"ok": False, "error": "empty_dataframe", "symbol": symbol, "code": code})
        return 0

    rows = []
    for _, row in df.tail(120).iterrows():
        rows.append(normalize_row(row))
    rows = [r for r in rows if r is not None]
    if not rows:
        emit({"ok": False, "error": "no_valid_rows", "symbol": symbol})
        return 0

    # Prefer current/latest trading date rows to avoid mixing prior days in intraday indicators.
    latest_date = str(rows[-1]["ts"]).split(" ")[0]
    same_day_rows = [r for r in rows if str(r["ts"]).startswith(latest_date)]
    if len(same_day_rows) >= 20:
        rows = same_day_rows

    closes = [r["close"] for r in rows]
    last = rows[-1]
    prev_close = closes[-2] if len(closes) >= 2 else closes[-1]
    day_change_pct = ((last["close"] - prev_close) / prev_close * 100) if prev_close else 0.0

    # Lightweight proxies (real values should come from dedicated breadth/funds providers later)
    turnover_heat = min(1.0, max(0.0, ratio([r["volume"] for r in rows], 5, 30) / 2))
    sentiment = min(1.0, max(0.0, 0.5 + day_change_pct / 6))
    sector_heat = min(1.0, max(0.0, 0.45 + day_change_pct / 10))

    emit({
        "ok": True,
        "source": "akshare-proxy",
        "snapshot": {
            "symbol": symbol,
            "source": "akshare-proxy",
            "lastPrice": round2(last["close"]),
            "dayChangePct": round2(day_change_pct),
            "turnoverHeat": round2(turnover_heat),
            "sentiment": round2(sentiment),
            "sectorHeat": round2(sector_heat),
            "regime": "risk-on" if sentiment > 0.65 else ("risk-off" if sentiment < 0.35 else "range"),
            "asOf": last["ts"],
            "candles": rows,
        }
    })
    return 0


def normalize_row(row):
    d = row.to_dict()
    # Common AKShare minute columns
    ts = first_of(d, ["时间", "datetime", "日期", "time"])
    open_ = as_float(first_of(d, ["开盘", "open"]))
    close = as_float(first_of(d, ["收盘", "close", "最新价"]))
    high = as_float(first_of(d, ["最高", "high"]))
    low = as_float(first_of(d, ["最低", "low"]))
    volume = as_float(first_of(d, ["成交量", "volume", "vol"]))
    if not all(is_finite(x) for x in [open_, close, high, low]):
        return None
    # AKShare/EM minute history may include stale rows with open=0; drop them for indicators.
    if open_ <= 0 or high <= 0 or low <= 0 or close <= 0:
        return None
    return {
        "ts": normalize_ts(ts),
        "open": round2(open_),
        "high": round2(high),
        "low": round2(low),
        "close": round2(close),
        "volume": int(volume if is_finite(volume) else 0),
    }


def first_of(d, keys):
    for k in keys:
        if k in d:
            return d[k]
    return None


def normalize_ts(v):
    if v is None:
        return datetime.utcnow().isoformat() + "Z"
    s = str(v)
    # Try to preserve local timestamp text
    return s


def ratio(values, short_n, long_n):
    if len(values) < long_n:
        return 1.0
    s = sum(values[-short_n:]) / max(1, short_n)
    l = sum(values[-long_n:]) / max(1, long_n)
    return (s / l) if l else 1.0


def as_float(v):
    try:
        return float(v)
    except Exception:
        return float("nan")


def is_finite(v):
    return v == v and v not in (float("inf"), float("-inf"))


def round2(v):
    return round(float(v), 2)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))


if __name__ == "__main__":
    raise SystemExit(main())
