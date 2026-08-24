# SPOO 🏃 — 우리 아이 스포츠강좌 지원받기

우리 아이가 **스포츠강좌이용권** 지원 대상인지 1분 자가진단으로 확인하고,
우리 동네 지원 현황과 가까운 시설까지 찾아주는 비공식 정보 제공 서비스입니다.

🔗 https://1597circle.github.io/SPOO/

## 주요 기능

- **자가진단**: 아이 나이 · 가구 유형 · 이전 이용 여부로 지원 대상 여부 확인
- **우리 동네 현황**: 지역별 수급률, 도움이 필요한 지역 TOP 10
- **시설 찾기**: 위치 기반 근처 시설 검색, 종목/시간대/가격 필터
- **PWA 지원**: 홈 화면에 앱처럼 설치 가능

## 기술 스택

- Vanilla HTML / CSS / JavaScript (프레임워크 없음)
- [Naver Maps API](https://www.ncloud.com/product/applicationService/maps) — 지도 및 지오코딩
- GitHub Pages — 정적 호스팅
- Service Worker — 오프라인 캐싱 및 PWA 설치

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

매년 바뀌는 값(신청 기간, 결제 마감일, 데이터 기준일)은 `config.json` 하나만 수정하면 됩니다.
`index.html` 안의 텍스트를 직접 찾아 고칠 필요가 없습니다.

## 개인정보

이 서비스가 어떤 정보를 어떻게 다루는지는 [개인정보처리방침](./privacy.html)을 참고해주세요.
사용자 입력 정보는 서버로 전송되지 않고 브라우저에만 저장됩니다.

## 라이선스

[MIT](./LICENSE)
