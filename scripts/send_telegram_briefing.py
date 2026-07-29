#!/usr/bin/env python3
"""시세 요약(data/latest.json) + 최근 뉴스(config/news_feeds.json)를 텔레그램으로 전송한다.

필요한 환경변수:
  TELEGRAM_BOT_TOKEN
  TELEGRAM_CHAT_ID
"""
import html
import json
import os
import sys
import time
from calendar import timegm
from datetime import datetime, timezone, timedelta
from pathlib import Path

import feedparser
import requests

ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))
NEWS_LOOKBACK_HOURS = 15
NEWS_PER_FEED = 4
TELEGRAM_MAX_LEN = 4096


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_market_section():
    latest_path = ROOT / "data" / "latest.json"
    if not latest_path.exists():
        return "⚠️ 시세 데이터(data/latest.json)가 없습니다."

    data = load_json(latest_path)
    updated = datetime.fromisoformat(data["updated_at"]).astimezone(KST)
    lines = [f"📊 <b>시장 요약</b> (기준 {updated.strftime('%Y-%m-%d %H:%M')} KST)"]

    by_category = {}
    for item in data["items"]:
        by_category.setdefault(item["category"], []).append(item)

    for category, items in by_category.items():
        lines.append(f"\n<b>{html.escape(category)}</b>")
        for it in items:
            pct = it.get("change_pct")
            arrow = "🔺" if (pct or 0) > 0 else ("🔻" if (pct or 0) < 0 else "⏸")
            pct_str = f"{pct:+.2f}%" if pct is not None else "N/A"
            lines.append(f"  {arrow} {html.escape(it['name'])}: {it['price']:,.2f} ({pct_str})")

    return "\n".join(lines)


def entry_is_recent(entry, cutoff_utc):
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            return datetime.fromtimestamp(timegm(t), tz=timezone.utc) >= cutoff_utc
    return True  # 날짜 정보가 없으면 최신으로 간주(피드 자체가 최신순 정렬)


def build_news_section():
    feeds_path = ROOT / "config" / "news_feeds.json"
    feeds = load_json(feeds_path)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=NEWS_LOOKBACK_HOURS)

    lines = ["\n📰 <b>주요 뉴스</b>"]
    any_news = False
    for feed in feeds:
        try:
            parsed = feedparser.parse(feed["url"])
        except Exception as e:  # noqa: BLE001
            print(f"[WARN] {feed['name']} 파싱 실패: {e}", file=sys.stderr)
            continue

        recent = [e for e in parsed.entries if entry_is_recent(e, cutoff)][:NEWS_PER_FEED]
        if not recent:
            continue

        any_news = True
        lines.append(f"\n<b>{html.escape(feed['name'])}</b>")
        for e in recent:
            title = html.escape(e.get("title", "(제목 없음)"))
            link = e.get("link", "")
            lines.append(f'• <a href="{html.escape(link)}">{title}</a>')

    if not any_news:
        lines.append("최근 새 뉴스가 없습니다.")

    return "\n".join(lines)


def chunk_message(text, max_len=TELEGRAM_MAX_LEN):
    if len(text) <= max_len:
        return [text]
    chunks = []
    current = ""
    for line in text.split("\n"):
        if len(current) + len(line) + 1 > max_len:
            chunks.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current:
        chunks.append(current)
    return chunks


def send_telegram(token, chat_id, text):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    resp = requests.post(
        url,
        json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
        timeout=15,
    )
    if not resp.ok:
        print(f"[ERROR] 텔레그램 전송 실패: {resp.status_code} {resp.text}", file=sys.stderr)
        resp.raise_for_status()


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("[ERROR] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    now_kst = datetime.now(KST)
    header = f"🗓 <b>{now_kst.strftime('%Y-%m-%d (%a)')} 시황 브리핑</b>"
    message = "\n".join([header, "", build_market_section(), build_news_section()])

    for i, chunk in enumerate(chunk_message(message)):
        send_telegram(token, chat_id, chunk)
        if i > 0:
            time.sleep(1)

    print("[OK] 텔레그램 전송 완료")


if __name__ == "__main__":
    main()
