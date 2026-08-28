#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SPOO 좌표 채우기 (네이버 지오코딩) — v2 (중간 저장판)
====================================================================
시설 중 좌표(naver_lat/naver_lng)가 비어 있는 것들을 주소로 조회해 채웁니다.

v1 → v2에서 바뀐 점 (2026-08-29):
  - ⏱ 시간 예산(TIME_BUDGET, 기본 95분)을 스스로 지킵니다.
    워크플로의 2시간 제한에 걸려 강제 종료되기 전에, 알아서 멈추고 저장합니다.
  - 💾 10분마다 + 끝날 때, 지금까지 채운 결과를 즉시 커밋·푸시합니다.
    어떤 이유로 중단돼도 그때까지의 작업은 절대 사라지지 않습니다.
  - 같은 워크플로를 그냥 한 번 더 실행하면 "남은 것만" 이어서 채웁니다.

실행은 GitHub Actions의 "좌표 채우기" 워크플로가 합니다 (Run workflow 버튼).
필요한 Secrets: NAVER_KEY_ID / NAVER_KEY
"""

import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

KEY_ID = os.environ.get("NAVER_KEY_ID", "").strip()
KEY = os.environ.get("NAVER_KEY", "").strip()
MAX_CALLS = int(os.environ.get("MAX_CALLS", "15000"))
TIME_BUDGET = int(os.environ.get("TIME_BUDGET_SEC", str(95 * 60)))  # 95분
COMMIT_EVERY = int(os.environ.get("COMMIT_EVERY_SEC", str(10 * 60)))  # 10분
SLEEP = 0.2

API = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

START = time.monotonic()


def elapsed():
    return time.monotonic() - START


def geocode(addr):
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
    try:
        if not (33.0 <= float(lat) <= 38.7 and 124.5 <= float(lng) <= 132.0):
            return None
    except ValueError:
        return None
    return lat, lng


def save(path, data):
    with open(path, "w", encoding="utf-8") as out:
        json.dump(data, out, ensure_ascii=False)


_git_ready = False


def commit_progress(label):
    """지금까지 저장된 변경을 커밋·푸시합니다. 실패해도 조회는 계속합니다."""
    global _git_ready
    try:
        if not _git_ready:
            subprocess.run(["git", "config", "user.name", "spoo-geocode-bot"], check=True)
            subprocess.run(["git", "config", "user.email", "actions@github.com"], check=True)
            _git_ready = True
        subprocess.run(["git", "add"] + glob.glob("[0-9][0-9][0-9][0-9][0-9].json"), check=True)
        diff = subprocess.run(["git", "diff", "--cached", "--quiet"])
        if diff.returncode == 0:
            return  # 바뀐 게 없음
        subprocess.run(["git", "commit", "-m", f"지오코딩: 시설 좌표 보충 ({label}, 자동)"],
                       check=True, capture_output=True)
        subprocess.run(["git", "push"], check=True, capture_output=True)
        print(f"  💾 중간 저장 완료 ({label}) — 여기까지는 무슨 일이 있어도 안전합니다", flush=True)
    except Exception as e:
        print(f"  (중간 저장 실패 — 계속 진행: {type(e).__name__})", flush=True)


def main():
    if not KEY_ID or not KEY:
        print("::error::NAVER_KEY_ID / NAVER_KEY 시크릿이 설정되지 않았습니다.")
        return 1

    files = sorted(f for f in glob.glob("*.json") if re.fullmatch(r"\d{5}\.json", f))

    total = have = 0
    for f in files:
        for x in json.load(open(f, encoding="utf-8")):
            total += 1
            if (x.get("naver_lat") or "").strip() and (x.get("naver_lng") or "").strip():
                have += 1
    print(f"시작: 전체 {total:,}건 중 좌표 보유 {have:,}건 ({have/total*100:.1f}%)", flush=True)
    print(f"설정: 최대 {MAX_CALLS:,}건 · 시간 예산 {TIME_BUDGET//60}분 · {COMMIT_EVERY//60}분마다 중간 저장", flush=True)

    calls = filled = misses = errors = 0
    last_commit = time.monotonic()
    stop_reason = "전부 완료"

    for f in files:
        if stop_reason != "전부 완료":
            break
        data = json.load(open(f, encoding="utf-8"))
        changed = False
        for x in data:
            if calls >= MAX_CALLS:
                stop_reason = "호출 한도 도달"
                break
            if elapsed() > TIME_BUDGET:
                stop_reason = "시간 예산 소진"
                break
            if (x.get("naver_lat") or "").strip() and (x.get("naver_lng") or "").strip():
                continue
            addr = (x.get("addr") or "").strip()
            if not addr:
                continue
            calls += 1
            try:
                result = geocode(addr)
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"  통신 오류({type(e).__name__}): {addr[:40]}", flush=True)
                if errors == 30:
                    print("::warning::통신 오류 30회 초과 — 이번 실행을 저장 후 종료합니다.", flush=True)
                    stop_reason = "통신 오류 누적"
                    break
                time.sleep(SLEEP)
                continue
            time.sleep(SLEEP)
            if result:
                x["naver_lat"], x["naver_lng"] = result
                filled += 1
                changed = True
            else:
                misses += 1
            if calls % 1000 == 0:
                print(f"  진행: {calls:,}건 조회 · {filled:,}건 채움 · {elapsed()/60:.0f}분 경과", flush=True)
        if changed:
            save(f, data)
        # 10분마다: 지금까지 저장된 파일들을 커밋·푸시 (중단 대비)
        if time.monotonic() - last_commit > COMMIT_EVERY:
            commit_progress(f"진행 {calls:,}건")
            last_commit = time.monotonic()

    # 마지막 저장
    commit_progress("마무리")

    print(flush=True)
    print(f"종료 사유: {stop_reason}", flush=True)
    print(f"결과: 호출 {calls:,}건 → 채움 {filled:,}건 · 못 찾음 {misses:,}건 · 오류 {errors:,}건", flush=True)
    new_have = have + filled
    print(f"현재 커버리지: {new_have:,}/{total:,} ({new_have/total*100:.1f}%)", flush=True)
    remaining_candidates = total - new_have
    if stop_reason != "전부 완료" and remaining_candidates:
        print(f"::notice::아직 남은 시설이 있습니다. 같은 워크플로를 한 번 더 실행하면 이어서 채웁니다.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
