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
  - 이 테스트는 index.html 안의 전역 함수(openRegionView, openFacilityView, toggleMoreInfo)를
    직접 호출해서 화면을 전환합니다. 이 함수들의 "이름"이 바뀌면 테스트도 같이 고쳐야 합니다.
  - 지도(네이버맵)는 외부 스크립트 로딩 타이밍에 따라 스크린샷이 흔들릴 수 있어
    지도가 보이는 상태는 기본 테스트에서 제외했습니다. 지도 UI를 검증하고 싶다면
    별도 테스트를 추가하고 waitForTimeout을 넉넉히 주세요.
*/

test.beforeEach(async ({ context }) => {
  // 위치 권한 팝업이 스크린샷마다 다르게 뜨는 것을 방지 (항상 거부 상태로 고정)
  await context.grantPermissions([]);
});

test.describe('보호자용 화면 (5-1)', () => {
  test('첫 화면 - 자가진단 진입 전', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('5-1_home.png', { fullPage: true });
  });

  test('놓치기 쉬운 안내 섹션 펼침', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.toggleMoreInfo && window.toggleMoreInfo());
    await page.waitForTimeout(300); // CSS 트랜지션 종료 대기
    await expect(page).toHaveScreenshot('5-1_more_info_expanded.png', { fullPage: true });
  });
});

test.describe('정책·현장 담당자용 화면 (5-2)', () => {
  test('지역 현황 보기 진입 화면', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.openRegionView && window.openRegionView());
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('5-2_region_view_entry.png', { fullPage: true });
  });

  test('지역 검색 후 상세 결과', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.openRegionView && window.openRegionView());
    await page.waitForTimeout(300);

    const searchInput = page.locator('#rvSearchInput');
    await searchInput.fill('강남구');
    await page.waitForTimeout(500); // 자동완성/검색 결과 렌더링 대기

    // 검색 결과 목록에서 첫 항목을 클릭 (구조가 바뀌면 이 셀렉터도 갱신 필요)
    const firstResult = page.locator('#regionViewOverlay [onclick*="selectRegion"], #regionViewOverlay .rv-search-result').first();
    if (await firstResult.count()) {
      await firstResult.click();
      await page.waitForTimeout(800); // 해당 지역 JSON 로드 대기
    }

    await expect(page).toHaveScreenshot('5-2_region_view_detail.png', { fullPage: true });
  });
});

test.describe('시설 운영자용 화면 (5-3)', () => {
  test('시설 운영자 진입 화면', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => window.openFacilityView && window.openFacilityView());
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('5-3_facility_owner_entry.png', { fullPage: true });
  });
});

test.describe('PWA / 메타 기본 확인', () => {
  test('테마 색상 및 타이틀이 유지되는지', async ({ page }) => {
    await page.goto('/');
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBe('#3182F6'); // 파란 테마. 색이 바뀌면 이 값도 의도적으로 같이 수정할 것
    await expect(page).toHaveTitle(/SPOO/);
  });
});
