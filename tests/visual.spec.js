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

test.beforeEach(async ({ context }) => {
  // 위치 권한 팝업이 스크린샷마다 다르게 뜨는 것을 방지 (항상 거부 상태로 고정)
  await context.grantPermissions([]);
});

test.describe('보호자용 화면 (5-1)', () => {
  test('첫 화면', async ({ page }) => {
    await openApp(page);
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
