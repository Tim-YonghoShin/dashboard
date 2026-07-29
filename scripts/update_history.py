#!/usr/bin/env python3
"""config/tickers.json의 각 티커에 대해 일별 종가 히스토리를 data/history/<id>.csv에 저장한다.

파일이 없으면(최초 실행) BACKFILL_PERIOD(기본 20년)만큼 전체를 내려받고,
파일이 있으면 마지막 저장일 근처부터만 다시 받아 병합(upsert)한다 —
매일 돌려도 가볍고, 실행을 며칠 걸러도 다음 실행에서 빈틈이 메워진다.
"""
import csv
import statistics
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
HISTORY_DIR = ROOT / "data" / "history"
BACKFILL_PERIOD = "max"  # 티커별로 거래소에서 제공하는 가장 긴 일별 히스토리 (지수는 보통 수십 년)
INCREMENTAL_OVERLAP_DAYS = 10  # 마지막 저장일에서 이만큼 앞당겨 재조회 (휴장/정정 대비)
MAX_RETRIES = 3
RETRY_DELAY_SEC = 5


def load_json(path):
    import json

    with open(path, encoding="utf-8") as f:
        return json.load(f)


def read_existing(csv_path):
    rows = {}
    if not csv_path.exists():
        return rows
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows[row["date"]] = float(row["close"])
    return rows


def fetch_history(symbol, start=None, period=None):
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            ticker = yf.Ticker(symbol)
            if start is not None:
                hist = ticker.history(start=start)
            else:
                hist = ticker.history(period=period)
            return hist
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_SEC * attempt)
    print(f"[ERROR] {symbol} 히스토리 조회 실패: {last_err}", file=sys.stderr)
    return None


def write_csv(csv_path, rows):
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["date", "close"])
        for date in sorted(rows):
            writer.writerow([date, f"{rows[date]:.4f}"])


def compute_composite(entry):
    """구성요소별 전체구간 z-score를 평균해 합성지수를 계산한다.
    (공식 지수가 아니라 이 대시보드에서 직접 정의한 단순 정규화 평균 방식)
    """
    component_series = {}
    for cid in entry["components"]:
        path = HISTORY_DIR / f"{cid}.csv"
        rows = read_existing(path)
        if not rows:
            print(f"[WARN] {entry['id']} 합성 실패: 구성요소 {cid} 히스토리 없음", file=sys.stderr)
            return None
        component_series[cid] = rows

    common_dates = set.intersection(*(set(rows) for rows in component_series.values()))
    if not common_dates:
        print(f"[WARN] {entry['id']} 합성 실패: 구성요소간 공통 날짜 없음", file=sys.stderr)
        return None

    zscores = {}
    for cid, rows in component_series.items():
        values = list(rows.values())
        mean = statistics.fmean(values)
        stdev = statistics.pstdev(values) or 1.0
        zscores[cid] = {d: (rows[d] - mean) / stdev for d in common_dates}

    return {d: statistics.fmean(zscores[cid][d] for cid in entry["components"]) for d in common_dates}


def main():
    tickers = load_json(ROOT / "config" / "tickers.json")
    yf_tickers = [t for t in tickers if t.get("source") != "composite"]
    composite_tickers = [t for t in tickers if t.get("source") == "composite"]
    ok, failed = 0, []

    for t in yf_tickers:
        csv_path = HISTORY_DIR / f"{t['id']}.csv"
        existing = read_existing(csv_path)

        if existing:
            last_date = max(existing)
            start = (
                datetime.strptime(last_date, "%Y-%m-%d") - timedelta(days=INCREMENTAL_OVERLAP_DAYS)
            ).strftime("%Y-%m-%d")
            hist = fetch_history(t["symbol"], start=start)
        else:
            hist = fetch_history(t["symbol"], period=BACKFILL_PERIOD)

        if hist is None or hist.empty:
            failed.append(t["id"])
            continue

        for idx, row in hist.iterrows():
            close = row.get("Close")
            if close is None or close != close:  # NaN 체크
                continue
            existing[idx.strftime("%Y-%m-%d")] = float(close)

        write_csv(csv_path, existing)
        ok += 1
        print(f"[OK] {t['id']} ({t['symbol']}): {len(existing)}개 일별 데이터 -> {csv_path}")

    # 합성지수는 구성요소 CSV가 갱신된 뒤(위 루프 완료 후) 마지막에 계산한다.
    for t in composite_tickers:
        composite = compute_composite(t)
        if composite is None:
            failed.append(t["id"])
            continue
        write_csv(HISTORY_DIR / f"{t['id']}.csv", composite)
        ok += 1
        print(f"[OK] {t['id']} (composite): {len(composite)}개 일별 데이터")

    if failed:
        print(f"[WARN] 히스토리 조회 실패한 티커: {', '.join(failed)}", file=sys.stderr)

    print(f"[DONE] {ok}/{len(tickers)}개 티커 히스토리 갱신 완료")
    if ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
