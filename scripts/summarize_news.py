#!/usr/bin/env python3
"""config/news_feeds.json의 RSS에서 최근 뉴스를 모아 Gemini로 중요 헤드라인만
선별·요약해 data/news.json에 저장한다.

필요한 환경변수:
  GEMINI_API_KEY
"""
import json
import os
import sys
from calendar import timegm
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser
import requests

ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))
LOOKBACK_HOURS = 8  # 6시간 갱신 주기 + 여유
MAX_PER_FEED = 15
MAX_SELECTED = 10
GEMINI_MODEL = "gemini-flash-latest"


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def entry_published(entry):
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            return datetime.fromtimestamp(timegm(t), tz=timezone.utc)
    return None


def collect_candidates():
    feeds = load_json(ROOT / "config" / "news_feeds.json")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    candidates = []
    for feed in feeds:
        try:
            parsed = feedparser.parse(feed["url"])
        except Exception as e:  # noqa: BLE001
            print(f"[WARN] {feed['name']} 파싱 실패: {e}", file=sys.stderr)
            continue

        count = 0
        for entry in parsed.entries:
            if count >= MAX_PER_FEED:
                break
            published = entry_published(entry)
            if published and published < cutoff:
                continue
            candidates.append(
                {
                    "source": feed["name"],
                    "title": entry.get("title", ""),
                    "summary_raw": (entry.get("summary") or "")[:400],
                    "url": entry.get("link", ""),
                    "published": published.isoformat() if published else None,
                }
            )
            count += 1
    return candidates


def build_candidate_list(candidates):
    lines = []
    for i, c in enumerate(candidates):
        lines.append(f"[{i}] ({c['source']}) {c['title']} — {c['summary_raw']}")
    return "\n".join(lines)


def call_gemini(api_key, candidates):
    prompt = f"""아래는 최근 {LOOKBACK_HOURS}시간 이내 국내외 경제/시장 뉴스 후보 목록입니다.
이 중 시황 대시보드에 보여줄 만큼 중요한 "시장 관련" 헤드라인만 최대 {MAX_SELECTED}개 선별하세요.
- 연예/스포츠/단순 사건사고 등 시장과 무관한 기사는 제외
- 국내·해외 균형 있게 선택 (한쪽에 치우치지 말 것)
- 같은 사안을 다루는 중복 기사는 하나만
- 각 항목에 대해 원문 내용을 바탕으로 한국어로 1~2문장 간결 요약 작성

후보 목록 (각 줄 맨 앞 [번호]가 index입니다):
{build_candidate_list(candidates)}
"""
    res = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        params={"key": api_key},
        json={
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 3072,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "index": {"type": "INTEGER"},
                            "summary": {"type": "STRING"},
                        },
                        "required": ["index", "summary"],
                    },
                },
            },
        },
        timeout=60,
    )
    res.raise_for_status()
    data = res.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[ERROR] GEMINI_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
        sys.exit(1)

    candidates = collect_candidates()
    items = []

    if not candidates:
        print("[WARN] 수집된 뉴스 후보가 없습니다.")
    else:
        try:
            selected = call_gemini(api_key, candidates)
        except Exception as e:  # noqa: BLE001
            print(f"[ERROR] Gemini 요약 실패: {e}", file=sys.stderr)
            sys.exit(1)

        seen_urls = set()
        for sel in selected:
            idx = sel.get("index")
            if not isinstance(idx, int) or not (0 <= idx < len(candidates)):
                continue
            c = candidates[idx]
            if c["url"] in seen_urls:
                continue
            seen_urls.add(c["url"])
            items.append(
                {
                    "title": c["title"],
                    "summary": sel.get("summary", ""),
                    "source": c["source"],
                    "url": c["url"],
                    "published": c["published"],
                }
            )

    payload = {"generated_at": datetime.now(KST).isoformat(), "items": items}

    out_path = ROOT / "data" / "news.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[OK] 뉴스 {len(items)}건 저장 -> {out_path} (후보 {len(candidates)}건 중 선별)")


if __name__ == "__main__":
    main()
