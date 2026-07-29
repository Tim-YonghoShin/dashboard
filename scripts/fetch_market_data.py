#!/usr/bin/env python3
"""config/tickers.json의 티커들을 yfinance로 조회해 data/latest.json을 갱신한다."""
import csv
import json
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))
MAX_RETRIES = 3
RETRY_DELAY_SEC = 5


def load_tickers():
    with open(ROOT / "config" / "tickers.json", encoding="utf-8") as f:
        return json.load(f)


def fetch_one(symbol):
    """(price, prev_close) 튜플을 반환. 실패 시 None."""
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            fi = yf.Ticker(symbol).fast_info
            price = fi.get("lastPrice") if hasattr(fi, "get") else fi.last_price
            prev = fi.get("previousClose") if hasattr(fi, "get") else fi.previous_close
            if price is not None and prev is not None:
                return float(price), float(prev)
            raise ValueError(f"missing price/previousClose for {symbol}")
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_SEC * attempt)
    print(f"[WARN] {symbol} fast_info 실패({last_err}), history()로 재시도", file=sys.stderr)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            hist = yf.Ticker(symbol).history(period="5d")
            closes = hist["Close"].dropna()
            if len(closes) >= 2:
                return float(closes.iloc[-1]), float(closes.iloc[-2])
            raise ValueError(f"insufficient history rows for {symbol}")
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_SEC * attempt)

    print(f"[ERROR] {symbol} 조회 실패: {last_err}", file=sys.stderr)
    return None


def fetch_composite(ticker_id):
    """합성지수는 yfinance가 아니라 update_history.py가 계산해둔 히스토리 CSV 마지막 2개 값을 사용한다."""
    path = ROOT / "data" / "history" / f"{ticker_id}.csv"
    if not path.exists():
        print(f"[WARN] {ticker_id} 히스토리 없음(update_history.py 먼저 실행 필요)", file=sys.stderr)
        return None
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if len(rows) < 2:
        return None
    return float(rows[-1]["close"]), float(rows[-2]["close"])


def main():
    tickers = load_tickers()
    items = []
    for t in tickers:
        if t.get("source") == "composite":
            result = fetch_composite(t["id"])
        else:
            result = fetch_one(t["symbol"])
        if result is None:
            continue
        price, prev = result
        change = price - prev
        change_pct = (change / prev * 100) if prev else None
        items.append(
            {
                "id": t["id"],
                "category": t["category"],
                "name": t["name"],
                "symbol": t.get("symbol", "COMPOSITE"),
                "hero": t.get("hero", False),
                "description": t.get("description", ""),
                "unit": t.get("unit"),
                "price": round(price, 4),
                "prev_close": round(prev, 4),
                "change": round(change, 4),
                "change_pct": round(change_pct, 3) if change_pct is not None else None,
            }
        )

    if not items:
        print("[ERROR] 수집된 데이터가 하나도 없습니다. latest.json을 갱신하지 않습니다.", file=sys.stderr)
        sys.exit(1)

    payload = {
        "updated_at": datetime.now(KST).isoformat(),
        "items": items,
    }

    out_path = ROOT / "data" / "latest.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[OK] {len(items)}/{len(tickers)}개 티커 저장 완료 -> {out_path}")
    if len(items) < len(tickers):
        missing = len(tickers) - len(items)
        print(f"[WARN] {missing}개 티커는 이번 실행에서 조회 실패", file=sys.stderr)


if __name__ == "__main__":
    main()
