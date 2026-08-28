#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SPOO 좌표 채우기 (네이버 지오코딩)
====================================================================
시설 28,201건 중 좌표(naver_lat/naver_lng)가 비어 있는 13,000여 건을
주소로 좌표를 조회해 채웁니다. 좌표가 없는 시설은 "내 위치로 찾기",
거리순 정렬, 지도 핀에서 보이지 않기 때문입니다.

■ 실행 방법 (직접 실행할 필요 없음 — GitHub Actions용)
  이 스크립트는 ".github/workflows/geocode.yml" 워크플로가 실행합니다.
  Actions 탭에서 "좌표 채우기" → Run workflow 버튼만 누르면 됩니다.

■ 필요한 것: 네이버 클라우드 지오코딩 API 키 2개
  GitHub 저장소 Settings → Secrets and variables → Actions 에
  NAVER_KEY_ID / NAVER_KEY 라는 이름으로 저장해두면 워크플로가 읽어갑니다.

■ 안전 장치
  - 이미 좌표가 있는 시설은 절대 건드리지 않습니다 (비어 있는 것만 채움).
  - 주소를 못 찾은 시설은 그대로 두고 넘어갑니다 (다음 실행 때 재시도).
  - MAX_CALLS(기본 15,000)만큼만 호출하고 멈추므로 폭주하지 않습니다.
  - 초당 5회로 천천히 호출합니다 (네이버 속도 제한 준수).
  - 어떤 경우에도 파일을 깨뜨리지 않도록, 다 만든 뒤 한 번에 저장합니다.
"""

import glob
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

KEY_ID = os.environ.get("NAVER_KEY_ID", "").strip()
KEY = os.environ.get("NAVER_KEY", "").strip()
MAX_CALLS = int(os.environ.get("MAX_CALLS", "15000"))
SLEEP = 0.2  # 초당 5회

API = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)


def geocode(addr):
    """주소 → (lat, lng) 또는 None. 네트워크 오류는 호출한 쪽에서 처리."""
    url = API + "?query=" + urllib.parse.quote(addr)
    req = urllib.request.Request(url, headers={
        "x-ncp-apigw-api-key-id": KEY_ID,
        "x-ncp-apigw-api-key": KEY,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.load(resp)
    addresses = data.get("addresses") or []
    if not addresses:
        return None
    a = addresses[0]
    lat, lng = a.get("y", ""), a.get("x", "")
    # 한반도 범위 밖이면 오탐으로 보고 버립니다
    try:
        if not (33.0 <= float(lat) <= 38.7 and 124.5 <= float(lng) <= 132.0):
            return None
    except ValueError:
        return None
    return lat, lng


def main():
    if not KEY_ID or not KEY:
        print("::error::NAVER_KEY_ID / NAVER_KEY 시크릿이 설정되지 않았습니다.")
        print("저장소 Settings → Secrets and variables → Actions 에서 두 값을 등록해주세요.")
        return 1

    files = sorted(f for f in glob.glob("*.json") if re.fullmatch(r"\d{5}\.json", f))

    # 진행 상황 파악
    total = have = 0
    for f in files:
        for x in json.load(open(f, encoding="utf-8")):
            total += 1
            if (x.get("naver_lat") or "").strip() and (x.get("naver_lng") or "").strip():
                have += 1
    print(f"시작: 전체 {total:,}건 중 좌표 보유 {have:,}건 ({have/total*100:.1f}%)")
    print(f"이번 실행 최대 호출: {MAX_CALLS:,}건 (약 {MAX_CALLS*SLEEP/60:.0f}분)")

    calls = filled = misses = errors = 0
    for f in files:
        data = json.load(open(f, encoding="utf-8"))
        changed = False
        for x in data:
            if calls >= MAX_CALLS:
                break
            if (x.get("naver_lat") or "").strip() and (x.get("naver_lng") or "").strip():
                continue  # 이미 좌표 있음 — 건드리지 않음
            addr = (x.get("addr") or "").strip()
            if not addr:
                continue  # 주소가 없으면 조회 불가
            calls += 1
            try:
                result = geocode(addr)
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  통신 오류({type(e).__name__}): {addr[:40]}")
                if errors == 30:
                    print("::warning::통신 오류가 30회를 넘어 이번 실행을 중단합니다. "
                          "API 키·한도를 확인한 뒤 다시 실행해주세요.")
                    calls = MAX_CALLS
                time.sleep(SLEEP)
                continue
            time.sleep(SLEEP)
            if result:
                x["naver_lat"], x["naver_lng"] = result
                filled += 1
                changed = True
            else:
                misses += 1
        if changed:
            # 원본과 같은 형식(한 줄 JSON, 한글 그대로)으로 저장
            with open(f, "w", encoding="utf-8") as out:
                json.dump(data, out, ensure_ascii=False)
        if calls >= MAX_CALLS:
            break

    print()
    print(f"완료: 호출 {calls:,}건 → 좌표 채움 {filled:,}건 · "
          f"주소 못 찾음 {misses:,}건 · 통신 오류 {errors:,}건")
    new_have = have + filled
    print(f"현재 커버리지: {new_have:,}/{total:,} ({new_have/total*100:.1f}%)")
    if filled and new_have / total * 100 > 60:
        print("::notice::커버리지가 크게 올랐습니다. tools/check_data_quality.py의 "
              "BASELINE['min_coord_coverage_pct'] 값을 현재 수치 근처로 올려두면 "
              "다시 나빠질 때 자동으로 잡아냅니다.")
    remaining = total - new_have
    if remaining and calls >= MAX_CALLS:
        print(f"::notice::아직 {remaining:,}건이 남았습니다. "
              f"워크플로를 한 번 더 실행하면 이어서 채웁니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
