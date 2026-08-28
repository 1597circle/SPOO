# SPOO 🏃 — 우리 아이 스포츠강좌 지원받기

우리 아이가 **스포츠강좌이용권** 지원 대상인지 1분 자가진단으로 확인하고,
우리 동네 지원 현황과 가까운 시설까지 찾아주는 비공식 정보 제공 서비스입니다.

🔗 https://1597circle.github.io/SPOO/

## 주요 기능

- **자가진단**: 아이 나이 · 가구 유형 · 이전 이용 여부로 지원 대상 여부 확인
- **우리 동네 현황**: 지역별 수급률, 도움이 필요한 지역 TOP 10
- **시설 찾기**: 위치 기반 근처 시설 검색, 종목/시간대/가격 필터
- **PWA 지원**: 홈 화면에 앱처럼 설치 가능

## 파일 구조

```
index.html               HTML 구조만
style.css                전체 스타일 (색상 등은 DESIGN_TOKENS.md 참고)
app.js                   메인 로직
naver-auth-handler.js    네이버맵 인증 실패 시 안내 (네이버맵 스크립트보다 먼저 로드되어야 함)
service-worker.js        PWA 오프라인 캐싱
manifest.json            PWA 설정
{시군구코드}.json (229개)  지역별 시설 데이터 (예: 11680.json = 강남구) — 저장소 루트에 위치
facility_counts.json     지역별 시설 "개수"만 (빠른 통계 표시용)
facility_names_index.json 전국 시설 이름 검색용 경량 인덱스
sport_types.json         종목 필터 목록
region_population.json   시군구별 인구 (규모 비교 기능용)
config.json              매년 바뀌는 값 (신청기간 등)
인접시군구_매핑.json       옆동네 시설 확장 기능용
privacy.html             개인정보처리방침
```

## 기술 스택

- Vanilla HTML / CSS / JavaScript (프레임워크 없음, 빌드 과정 없음)
- [Naver Maps API](https://www.ncloud.com/product/applicationService/maps) — 지도 및 지오코딩
- [SheetJS](https://sheetjs.com), [jsPDF](https://github.com/parallax/jsPDF) — 엑셀/PDF 다운로드
- GitHub Pages — 정적 호스팅
- Service Worker — 오프라인 캐싱 및 PWA 설치

## 디자인 시스템

색상·폰트 크기 등은 전부 `style.css`의 `:root{}` 변수로 관리합니다.
새 색이나 스타일을 추가하기 전에 [DESIGN_TOKENS.md](./DESIGN_TOKENS.md)를 먼저 확인해주세요.

## 로컬에서 실행하기

별도 빌드 과정 없이 정적 파일이라, 로컬 서버로 열면 됩니다.

```bash
git clone https://github.com/1597circle/SPOO.git
cd SPOO
python3 -m http.server 8000
# 이후 http://localhost:8000 접속
```
(`file://`로 직접 열면 CSV/JSON fetch가 브라우저 보안 정책에 막힐 수 있어 로컬 서버 사용을 권장합니다.)

## 데이터 갱신

매년 바뀌는 값은 **`config.json` 하나만** 수정하면 됩니다. `index.html`이나 `app.js` 안의
숫자를 직접 찾아 고칠 필요가 없습니다.

| 항목 | 설명 |
|---|---|
| `applyPeriod` | 전국 동시 신청 기간 |
| `applyPeriodConfirmed` | 공식 공고 전이면 `false` — 화면에 "(예상)"이 붙습니다 |
| `paymentDeadline` | 결제 마감일 |
| `voucherMonthlyLimit` | 월 지원 한도 (본인부담금 계산에 직접 쓰입니다) |
| `multiMonthPaymentLimit` | 이 금액 이상은 결제 주기가 달라 "금액 확인 필요"로 안내 |
| `dataUpdatedAt` · `regionCount` | 헤더에 표시되는 데이터 기준일·지역 수 |

데이터를 갱신한 뒤에는 품질 게이트를 한 번 돌려주세요. 커밋하면 CI에서도 자동으로 돕니다.

```bash
python3 tools/check_data_quality.py
```

## 개인정보

이 서비스가 어떤 정보를 어떻게 다루는지는 [개인정보처리방침](./privacy.html)을 참고해주세요.
사용자 입력 정보는 서버로 전송되지 않고 브라우저에만 저장됩니다.

## 라이선스

[MIT](./LICENSE)
