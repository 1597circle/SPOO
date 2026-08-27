// SPOO 서비스워커 — 앱처럼 설치 가능하게 하고, 기본적인 오프라인 캐싱을 제공합니다.
const CACHE_NAME = 'spoo-v4'; // v3→v4: 신규 기능 4종(캘린더·음성·다국어·PWA바로가기) + 타이포 통일 릴리스 반영
const CORE_FILES = [
  './index.html',
  './style.css',
  './app.js',
  './naver-auth-handler.js',
  './manifest.json',
  './config.json',
  './voucher_data.csv',
  './facility_counts.json',
  './facility_names_index.json',
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
  // courses.csv, facilities/{code}.json 은 용량이 크고 지역별로 그때그때 필요한 것만 불러오는
  // 파일들이라 여기서 미리 캐시하지 않습니다 (fetch 이벤트에서 요청 시점에 자동으로 캐시됨).
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
self.addEventListener('fetch', (event) => {
  // 네이버 지도 API, 외부 CDN 등은 서비스워커가 건드리지 않고 그대로 통과시킴
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
