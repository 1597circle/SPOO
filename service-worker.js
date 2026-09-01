// SPOO 서비스워커 — 앱처럼 설치 가능하게 하고, 기본적인 오프라인 캐싱을 제공합니다.
const CACHE_NAME = 'spoo-v22'; // v21→v22: 담당자 카드 강조숫자 가독성, 320px 헤더 가로스크롤, CSV 안내 줄바꿈, 키보드 포커스 표시 복구
const CORE_FILES = [
  './index.html',
  './style.css',
  './app.js',
  './naver-auth-handler.js',
  './manifest.json',
  './config.json',
  './voucher_data.csv',
  './facility_counts.json',
  './sport_types.json',
  './region_population.json',
  './sigungu_simplified.json',
  './인접시군구_매핑.json',
  './privacy.html',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './i18n/en.json',
  './i18n/vi.json',
  './i18n/zh.json',
  './shortcut-diagnose.png',
  './shortcut-facility.png'
  // courses.csv, facility_names_index.json, {지역코드}.json 은 용량이 크거나(각각 14MB·3.8MB)
  // 특정 화면에서만 쓰는 파일이라 미리 캐시하지 않습니다 (fetch 이벤트에서 요청 시점에 자동 캐시).
  // facility_names_index.json은 시설 운영자 화면 전용이라 v21부터 프리캐시에서 뺐습니다 —
  // 예전엔 모든 방문자가 설치 시 3.8MB를 한 번 더 내려받았습니다.
];

// 설치 시 핵심 파일들을 미리 캐시해둠
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_FILES).catch((err) => {
        // 파일 하나가 없어도 전체 설치가 실패하지 않도록
        console.log('일부 파일 캐시 실패(무시 가능):', err);
      });
    })
  );
  self.skipWaiting();
});

// 오래된 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 네트워크 우선, 실패하면 캐시 사용 (데이터는 항상 최신을 우선시하되, 오프라인이면 캐시로 대체)
//
// QA 지적(2026-08-29) 수정: index.html·app.js 등은 ?v=버전 쿼리스트링을 붙여 요청하는데,
// 설치 시 미리 캐시해둔 파일들은 쿼리 없는 './app.js' 형태로 저장돼서 caches.match()가
// 서로 다른 요청으로 취급해 못 찾았습니다. 그래서 프리캐시 23개 파일이 실제로는 한 번도
// 쓰이지 못하고, 온라인으로 최소 한 번 접속해 런타임 캐시가 쌓이기 전까지는 오프라인 첫 실행이
// 그대로 실패했습니다. 페이지 자체를 여는 요청(주소 끝 '/'라 './index.html'과 파일명이 다른
// 경우 포함)도 마찬가지로 못 찾아서 오프라인 내비게이션이 실패했습니다.
// → ignoreSearch로 쿼리스트링 차이를 무시하고, 페이지 이동 요청은 무조건 index.html로
//   대체하도록 고쳤습니다. 또한 404/500 같은 에러 응답을 캐시에 저장하지 않도록 response.ok도 확인합니다.
self.addEventListener('fetch', (event) => {
  // 네이버 지도 API, 외부 CDN 등은 서비스워커가 건드리지 않고 그대로 통과시킴
  if (!event.request.url.startsWith(self.location.origin)) return;

  // courses.csv(약 14MB)는 캐시하지 않습니다 — 모바일에서 저장 공간을 순식간에 채우고,
  // 어차피 강좌 정보는 온라인일 때만 의미가 있습니다.
  const isHuge = event.request.url.includes('courses.csv');
  const isNavigation = event.request.mode === 'navigate';

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!isHuge && response && response.ok) {
          const clone = response.clone();
          // 저장 공간이 가득 차도 화면 동작에는 영향이 없도록 실패를 조용히 무시
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(event.request, clone))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => {
        if (isNavigation) {
          // 주소가 '/SPOO/'처럼 파일명 없이 끝나도 항상 index.html로 응답
          return caches.match('./index.html', { ignoreSearch: true })
            .then((cached) => cached || caches.match(event.request, { ignoreSearch: true }));
        }
        return caches.match(event.request, { ignoreSearch: true });
      })
  );
});
