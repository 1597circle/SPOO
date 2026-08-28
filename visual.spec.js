// @ts-check
const { test, expect } = require('@playwright/test');

/*
  SPOO 시각적 회귀 테스트
  ------------------------------------------------------------
  처음 실행 시 (기준 스크린샷이 없을 때):
    npm install
    npx playwright install --with-deps chromium
    npm run test:visual:update     ← 기준(baseline) 스크린샷을 생성/커밋합니다

  이후에는:
    npm run test:visual            ← 기준과 비교, 달라진 부분이 있으면 실패 + diff 이미지 생성

  화면이 의도적으로 바뀐 경우 (디자인 변경 등):
    npm run test:visual:update     ← 새 기준으로 갱신 후 커밋

  주의:
  - page.goto('./')를 써야 합니다. '/'로 하면 baseURL의 /SPOO/ 경로가 지워져서
    엉뚱한 404 페이지로 이동합니다 (실제로 이 실수 때문에 테스트가 통째로 깨진 적 있음).
  - 사이트에 약 3.4초짜리 인트로 스플래시가 있어서, 화면을 찍기 전에 5초를 기다립니다.
  - 지도(네이버맵)·강좌 데이터가 백그라운드에서 계속 로드되므로 networkidle은 쓰지 않습니다.
*/

// 앱을 열고 인트로 스플래시가 끝날 때까지 기다리는 공용 함수
async function openApp(page){
  await page.goto('./');
  await page.waitForTimeout(5000); // 인트로 스플래시(약 3.4초) 종료 + CI 환경 여유분 대기
}

/*
  ⚠ 스크린샷 비교만으로는 "사이트가 죽은 것"을 못 잡습니다.
  실제로 2026-08-28 점검에서, 네이버 지도 스크립트가 안 뜨면 init()이 통째로
  실행되지 않아 수급 데이터·시설·검색이 전부 빈 상태가 되는 문제가 확인됐습니다.
  그런데 첫 화면과 진입 화면은 정적 HTML이라 픽셀이 똑같아서 테스트는 통과했습니다.

  그래서 "화면이 그대로인가"와 별개로 "데이터가 실제로 들어왔는가"를 함께 봅니다.
  이 어서션 하나가 사이트 전체 장애를 매일 06시에 잡아냅니다.
*/
async function expectDataLoaded(page, expect){
  const state = await page.evaluate(() => ({
    voucher:  typeof voucherData       !== 'undefined' ? Object.keys(voucherData).length   : -1,
    counts:   typeof facilityCounts    !== 'undefined' ? Object.keys(facilityCounts).length: -1,
    search:   typeof regionSearchList  !== 'undefined' ? regionSearchList.length           : -1,
    polygons: typeof polygons          !== 'undefined' ? polygons.length                   : -1,
  }));
  expect(state.voucher,  '수급 데이터(voucherData)가 로드되지 않았습니다').toBe(229);
  expect(state.counts,   '시설 개수(facilityCounts)가 로드되지 않았습니다').toBe(229);
  expect(state.search,   '지역 검색 목록이 비어 있습니다').toBe(229);
  expect(state.polygons, '지역 경계 데이터가 없습니다 — 「내 위치로 찾기」가 동작하지 않습니다')
    .toBeGreaterThan(200);
}

test.beforeEach(async ({ context }) => {
  // 위치 권한 팝업이 스크린샷마다 다르게 뜨는 것을 방지 (항상 거부 상태로 고정)
  await context.grantPermissions([]);
});

test.describe('데이터 로딩 (화면보다 먼저 확인할 것)', () => {
  test('필수 데이터 229개 지역이 모두 들어왔는지', async ({ page }) => {
    await openApp(page);
    await expectDataLoaded(page, expect);
  });

  test('지도가 안 떠도 나머지 기능은 살아있는지', async ({ page, context }) => {
    // 네이버 지도 스크립트만 차단해서, 지도 장애가 사이트 전체를 죽이지 않는지 확인합니다.
    await context.route('**/openapi.map.naver.com/**', route => route.abort());
    await openApp(page);
    await expectDataLoaded(page, expect);

    // 지도 자리에는 안내가 떠야 하고, 데이터 로딩 문구는 정상이어야 합니다.
    const status = await page.locator('#loadStatus').innerText();
    expect(status, '지도 장애가 데이터 오류로 잘못 안내되고 있습니다').not.toContain('불러오지 못했어요');
    expect(status).toContain('개 지역');
  });
});

test.describe('보호자용 화면 (5-1)', () => {
  test('첫 화면', async ({ page }) => {
    await openApp(page);
    await expectDataLoaded(page, expect);
    await expect(page).toHaveScreenshot('5-1_home.png', { fullPage: true });
  });
});

test.describe('정책·현장 담당자용 화면 (5-2)', () => {
  test('지역 현황 보기 진입 화면', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.openRegionView && window.openRegionView());
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('5-2_region_view_entry.png', { fullPage: true });
  });
});

test.describe('시설 운영자용 화면 (5-3)', () => {
  test('시설 운영자 진입 화면', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.openFacilityView && window.openFacilityView());
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('5-3_facility_owner_entry.png', { fullPage: true });
  });
});

test.describe('PWA / 메타 기본 확인', () => {
  test('테마 색상 및 타이틀이 유지되는지', async ({ page }) => {
    await page.goto('./');
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBe('#3182F6'); // 파란 테마. 색이 바뀌면 이 값도 의도적으로 같이 수정할 것
    await expect(page).toHaveTitle(/SPOO/);
  });
});
