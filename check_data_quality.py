#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SPOO 데이터 품질 게이트
====================================================================
기존 repo-checks.yml은 "파일이 있는지 / JSON이 깨졌는지"만 봤습니다.
그것만으로는 잡히지 않는 것들 — 좌표가 갑자기 사라지거나, 통계 파생값이
어긋나거나, 행정구역이 개편됐는데 지역명이 그대로이거나 — 을 여기서 봅니다.

핵심 원칙: 임계값은 "지금 수치"를 기준선으로 잡습니다.
          완벽함을 요구하는 게 아니라 **악화만 잡아냅니다.**
          품질을 개선했다면 아래 BASELINE 숫자를 함께 올려주세요.

로컬 실행:  python3 tools/check_data_quality.py
CI 실행:    문제가 있으면 종료코드 1
"""

import csv
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# ── 기준선 (2026-08-28 실측값 기준) ───────────────────────────────
BASELINE = {
    "region_count": 229,
    "min_coord_coverage_pct": 51.0,   # 실측 51.9% — 이보다 떨어지면 실패
    "min_course_join_pct": 97.0,      # 실측 98.0%
    "max_duplicate_courses": 1500,    # 실측 1,442행
    "max_duplicate_facilities": 20,   # 실측 16건
    "max_bad_time_pct": 7.0,          # 실측 6.4% (start >= end)
    "max_unknown_sport_types": 100,   # 실측 88건
}

# 정식 시군구명이 아닌데 데이터에 나타나면 알려줍니다.
# 행정구역이 개편되면 여기에 새 이름을 추가하고, 폐지된 이름은 RETIRED로 옮기세요.
RETIRED_SGG = {
    # 2026-07-01 인천형 행정체제 개편으로 폐지된 이름
    ("인천광역시", "중구"): "제물포구 / 영종구",
    ("인천광역시", "동구"): "제물포구",
    ("인천광역시", "서구"): "서해구 / 검단구",
}

problems = []   # 빌드 실패
warnings = []   # 알림만


def fail(msg):
    problems.append(msg)


def warn(msg):
    warnings.append(msg)


def region_files():
    return sorted(f for f in glob.glob("*.json") if re.fullmatch(r"\d{5}\.json", f))


# ══════════════════════════════════════════════════════════════════
# 1. 코드 집합 정합성 — 5개 데이터 소스가 같은 229개 지역을 보고 있는가
# ══════════════════════════════════════════════════════════════════
def check_code_sets():
    files = {f[:-5] for f in region_files()}
    if len(files) != BASELINE["region_count"]:
        fail(f"지역 JSON 파일이 {BASELINE['region_count']}개가 아님: {len(files)}개")

    sources = {}
    sources["facility_counts.json"] = set(json.load(open("facility_counts.json", encoding="utf-8")))
    sources["region_population.json"] = set(json.load(open("region_population.json", encoding="utf-8")))
    sources["인접시군구_매핑.json"] = set(json.load(open("인접시군구_매핑.json", encoding="utf-8")))
    with open("voucher_data.csv", encoding="utf-8-sig") as f:
        sources["voucher_data.csv"] = {r["code"] for r in csv.DictReader(f)}

    for name, codes in sources.items():
        only_files = sorted(files - codes)
        only_src = sorted(codes - files)
        if only_files:
            fail(f"{name}에 없는 지역 코드: {only_files[:10]} (총 {len(only_files)}개)")
        if only_src:
            fail(f"{name}에만 있고 실제 파일이 없는 코드: {only_src[:10]} (총 {len(only_src)}개)")
    return files


# ══════════════════════════════════════════════════════════════════
# 2. facility_counts 캐시가 실제 레코드 수와 맞는가
#    (틀리면 "우리 동네 시설 N개" 숫자가 통째로 거짓말이 됩니다)
# ══════════════════════════════════════════════════════════════════
def check_facility_counts():
    fc = json.load(open("facility_counts.json", encoding="utf-8"))
    mismatch = []
    total = 0
    for f in region_files():
        code = f[:-5]
        n = len(json.load(open(f, encoding="utf-8")))
        total += n
        if code in fc and fc[code] != n:
            mismatch.append(f"{code}: 캐시 {fc[code]} ≠ 실제 {n}")
    if mismatch:
        fail("facility_counts.json이 실제 시설 수와 다름 — " + "; ".join(mismatch[:8]))

    idx = json.load(open("facility_names_index.json", encoding="utf-8"))
    if len(idx) != total:
        fail(f"facility_names_index.json 항목 수({len(idx)})가 실제 시설 수({total})와 다름")
    return total


# ══════════════════════════════════════════════════════════════════
# 3. voucher_data.csv 파생값 재계산 — 수급률 %가 실제로 맞는가
# ══════════════════════════════════════════════════════════════════
def check_voucher_math():
    with open("voucher_data.csv", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        try:
            n_recv, s_recv = float(r["n_recv"]), float(r["s_recv"])
            n_t, s_t = float(r["n_target"]), float(r["s_target"])
            n_pct, s_pct = float(r["n_pct"]), float(r["s_pct"])
        except (ValueError, KeyError) as e:
            fail(f"{r.get('code')} {r.get('region')}: 숫자로 읽을 수 없는 값 ({e})")
            continue

        where = f"{r['code']} {r['region']}"
        if s_t and abs(s_recv / s_t * 100 - s_pct) > 0.05:
            fail(f"{where}: s_pct {s_pct} ≠ 재계산 {s_recv / s_t * 100:.2f}")
        if n_t and abs(n_recv / n_t * 100 - n_pct) > 0.05:
            fail(f"{where}: n_pct {n_pct} ≠ 재계산 {n_recv / n_t * 100:.2f}")
        if s_recv > s_t or n_recv > n_t:
            fail(f"{where}: 수급 인원이 대상 인원보다 많음")
        if min(n_recv, s_recv, n_t, s_t) < 0:
            fail(f"{where}: 음수 값")
        if max(n_pct, s_pct) > 100:
            fail(f"{where}: 수급률이 100%를 넘음")


# ══════════════════════════════════════════════════════════════════
# 4. 인접 시군구 매핑 — 유령 이웃 / 비대칭 관계
# ══════════════════════════════════════════════════════════════════
def check_neighbors(files):
    adj = json.load(open("인접시군구_매핑.json", encoding="utf-8"))
    dangling, asym = [], []
    for code, info in adj.items():
        ns = [n["code"] for n in info.get("neighbors", [])]
        if code in ns:
            fail(f"{code}가 자기 자신을 이웃으로 참조")
        for n in ns:
            if n not in files:
                dangling.append(f"{code}→{n}")
            elif code not in [x["code"] for x in adj[n].get("neighbors", [])]:
                asym.append(f"{code}→{n} (역방향 없음)")
    if dangling:
        fail(f"존재하지 않는 이웃 코드 {len(dangling)}건: {dangling[:6]}")
    if asym:
        fail(f"비대칭 인접 관계 {len(asym)}건: {asym[:6]}")


# ══════════════════════════════════════════════════════════════════
# 5. 시설 좌표 — 커버리지 회귀 감시 + 범위 이상치
#    좌표가 없는 시설은 "내 위치로 찾기"·거리순 정렬에서 사라집니다.
# ══════════════════════════════════════════════════════════════════
def check_coordinates():
    total = with_coord = 0
    out_of_range = []
    zero_regions = []
    for f in region_files():
        data = json.load(open(f, encoding="utf-8"))
        n_ok = 0
        for x in data:
            total += 1
            lat, lng = (x.get("naver_lat") or "").strip(), (x.get("naver_lng") or "").strip()
            if not lat or not lng:
                continue
            with_coord += 1
            n_ok += 1
            try:
                la, lo = float(lat), float(lng)
            except ValueError:
                out_of_range.append(f"{f[:-5]} {x.get('name')}: 숫자 아님")
                continue
            if not (33.0 <= la <= 38.7) or not (124.5 <= lo <= 132.0):
                out_of_range.append(f"{f[:-5]} {x.get('name')}: ({la}, {lo})")
        if data and n_ok == 0:
            zero_regions.append(f[:-5])

    pct = with_coord / total * 100 if total else 0
    if pct < BASELINE["min_coord_coverage_pct"]:
        fail(f"좌표 커버리지 {pct:.1f}% — 기준선 {BASELINE['min_coord_coverage_pct']}% 미만으로 떨어짐")
    if out_of_range:
        fail(f"한반도 범위를 벗어난 좌표 {len(out_of_range)}건: {out_of_range[:5]}")
    if zero_regions:
        warn(f"좌표가 하나도 없는 지역 {len(zero_regions)}곳: {', '.join(zero_regions[:12])}"
             f"{' 외' if len(zero_regions) > 12 else ''} — 이 지역에서는 위치 기반 기능이 동작하지 않습니다")
    print(f"   좌표 커버리지 {pct:.1f}% ({with_coord:,}/{total:,})")


# ══════════════════════════════════════════════════════════════════
# 6. 시군구명 유효성 — 행정구역 개편이 반영됐는가
# ══════════════════════════════════════════════════════════════════
def check_sgg_names():
    found = Counter()
    for f in region_files():
        for x in json.load(open(f, encoding="utf-8")):
            found[(x.get("sido", ""), x.get("sgg", ""))] += 1

    with open("voucher_data.csv", encoding="utf-8-sig") as f:
        voucher_names = {(r["sido"], r["region"]) for r in csv.DictReader(f)}

    for key, replacement in RETIRED_SGG.items():
        n = found.get(key, 0)
        if n:
            warn(f"폐지된 시군구명 '{key[0]} {key[1]}' 시설 {n}건 — '{replacement}'로 이관 필요")
        if key in voucher_names:
            warn(f"voucher_data.csv에 폐지된 지역명 '{key[0]} {key[1]}' — '{replacement}'로 갱신 필요")


# ══════════════════════════════════════════════════════════════════
# 7. courses.csv — 조인율·시간 이상치·중복
# ══════════════════════════════════════════════════════════════════
def check_courses():
    if not os.path.exists("courses.csv"):
        warn("courses.csv 없음 — 강좌 상세 검사를 건너뜁니다")
        return

    facility_keys = set()
    for f in region_files():
        for x in json.load(open(f, encoding="utf-8")):
            facility_keys.add((x.get("name", ""), x.get("sgg", "")))

    total = matched = bad_time = 0
    seen = Counter()
    with open("courses.csv", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            total += 1
            if (r["name"], r["sgg"]) in facility_keys:
                matched += 1
            s, e = (r.get("start_tm") or "").strip(), (r.get("end_tm") or "").strip()
            if s and e and s >= e:
                bad_time += 1
            seen[(r["name"], r["sgg"], r["course_nm"], r["day"], s, e, r["settl_amt"])] += 1

    join_pct = matched / total * 100 if total else 0
    if join_pct < BASELINE["min_course_join_pct"]:
        fail(f"강좌–시설 조인율 {join_pct:.1f}% — 기준선 {BASELINE['min_course_join_pct']}% 미만")

    dup = sum(c - 1 for c in seen.values() if c > 1)
    if dup > BASELINE["max_duplicate_courses"]:
        fail(f"중복 강좌 {dup}행 — 기준선 {BASELINE['max_duplicate_courses']}행 초과")

    bad_pct = bad_time / total * 100 if total else 0
    if bad_pct > BASELINE["max_bad_time_pct"]:
        fail(f"시작≥종료 시간 이상 {bad_pct:.1f}% — 기준선 {BASELINE['max_bad_time_pct']}% 초과")
    print(f"   강좌 조인율 {join_pct:.1f}% · 중복 {dup}행 · 시간이상 {bad_pct:.1f}%")


# ══════════════════════════════════════════════════════════════════
# 8. 종목 값이 sport_types.json 안에 있는가 (필터에서 누락되지 않도록)
# ══════════════════════════════════════════════════════════════════
def check_sport_types():
    known = set(json.load(open("sport_types.json", encoding="utf-8")))
    unknown = Counter()
    dup_total = 0
    for f in region_files():
        data = json.load(open(f, encoding="utf-8"))
        keys = Counter((x.get("name", ""), x.get("addr", ""), x.get("type", "")) for x in data)
        dup_total += sum(c - 1 for c in keys.values() if c > 1)
        for x in data:
            t = x.get("type", "")
            if t not in known:
                unknown[t] += 1
    n = sum(unknown.values())
    if n > BASELINE["max_unknown_sport_types"]:
        fail(f"sport_types.json에 없는 종목값 {n}건 — 기준선 {BASELINE['max_unknown_sport_types']}건 초과")
    if dup_total > BASELINE["max_duplicate_facilities"]:
        fail(f"완전 중복 시설 {dup_total}건 — 기준선 {BASELINE['max_duplicate_facilities']}건 초과")


# ══════════════════════════════════════════════════════════════════
# 9. i18n 키 패리티 + 죽은 번역 파일 감지
# ══════════════════════════════════════════════════════════════════
def check_i18n():
    langs = ["en", "vi", "zh"]
    key_sets = {}
    for lang in langs:
        path = f"i18n/{lang}.json"
        if not os.path.exists(path):
            fail(f"{path} 없음 — 해당 언어가 한국어로 표시됩니다")
            continue
        key_sets[lang] = set(json.load(open(path, encoding="utf-8")))
        # 앱은 i18n/ 만 읽습니다. 루트에 같은 이름이 있으면 고쳐도 반영되지 않아 혼란을 부릅니다.
        if os.path.exists(f"{lang}.json"):
            fail(f"루트의 {lang}.json은 앱이 사용하지 않습니다 (실제 사용: i18n/{lang}.json). "
                 f"삭제하거나, 이 파일을 고쳤다면 i18n/ 쪽에 반영해주세요")

    if len(key_sets) > 1:
        base_lang = max(key_sets, key=lambda k: len(key_sets[k]))
        for lang, keys in key_sets.items():
            missing = key_sets[base_lang] - keys
            if missing:
                warn(f"i18n/{lang}.json에 없는 키 {len(missing)}개: {sorted(missing)[:6]}")


# ══════════════════════════════════════════════════════════════════
# 10. config.json 신선도 — 지난 날짜를 안내하고 있지 않은가
# ══════════════════════════════════════════════════════════════════
def check_config():
    cfg = json.load(open("config.json", encoding="utf-8"))
    today = date.today()

    for key in ("voucherMonthlyLimit", "multiMonthPaymentLimit"):
        if not cfg.get(key):
            fail(f"config.json에 {key}가 없습니다 — app.js의 기본값이 그대로 쓰입니다")

    end = date.fromisoformat(cfg["applyPeriod"]["end"])
    if end < today:
        fail(f"신청 기간 종료일({end})이 이미 지났습니다 — config.json을 갱신해주세요")
    if cfg.get("applyPeriodConfirmed") is not True:
        warn("신청 기간이 아직 '예상'으로 표시됩니다 — 공식 공고가 나오면 "
             "applyPeriodConfirmed를 true로 바꿔주세요")

    pay = date.fromisoformat(cfg["paymentDeadline"])
    if pay < today:
        fail(f"결제 마감일({pay})이 이미 지났습니다 — config.json을 갱신해주세요")

    if cfg.get("regionCount") != BASELINE["region_count"]:
        fail(f"config.json regionCount({cfg.get('regionCount')})가 실제 지역 수와 다릅니다")


# ══════════════════════════════════════════════════════════════════
# 11. 저장소 위생 — 압축 파일이 다시 올라오지 않았는가
#     (.gitignore에 *.zip 이 있어도 이미 추적 중인 파일은 막지 못합니다)
# ══════════════════════════════════════════════════════════════════
def check_repo_hygiene():
    archives = sorted(glob.glob("*.zip") + glob.glob("*.rar"))
    if archives:
        fail(f"압축 파일이 저장소에 있습니다: {archives} — GitHub Pages로 그대로 공개되고, "
             f"사이트의 옛 사본이라 실제 코드와 어긋납니다. `git rm --cached` 후 커밋해주세요")

    for doc in ("HANDOVER.md",):
        if not os.path.exists(doc):
            warn(f"{doc}이 없습니다 — 워크플로와 TESTING.md가 이 문서를 근거로 참조하고 있습니다")


# ══════════════════════════════════════════════════════════════════
def main():
    print("SPOO 데이터 품질 게이트\n" + "=" * 52)
    steps = [
        ("코드 집합 정합성", lambda: check_code_sets()),
        ("시설 개수 캐시", lambda: check_facility_counts()),
        ("수급률 파생값 재계산", check_voucher_math),
        ("인접 시군구 매핑", lambda: check_neighbors({f[:-5] for f in region_files()})),
        ("시설 좌표", check_coordinates),
        ("시군구명 유효성", check_sgg_names),
        ("강좌 데이터", check_courses),
        ("종목 값·중복", check_sport_types),
        ("다국어 파일", check_i18n),
        ("config.json 신선도", check_config),
        ("저장소 위생", check_repo_hygiene),
    ]
    for label, fn in steps:
        print(f" · {label}")
        fn()

    print()
    for w in warnings:
        print(f"::warning::{w}")
    for p in problems:
        print(f"::error::{p}")

    print("=" * 52)
    if problems:
        print(f"❌ 실패 {len(problems)}건 · 경고 {len(warnings)}건")
        return 1
    print(f"✅ 통과 · 경고 {len(warnings)}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
