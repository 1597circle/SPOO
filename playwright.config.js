// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// 기본은 실제 배포 사이트를 대상으로 테스트합니다.
// 로컬에서 수정 중인 코드를 먼저 확인하고 싶다면:
//   1) 저장소 루트에서 `npx http-server -p 8080` (또는 `python3 -m http.server 8080`) 실행
//   2) TEST_URL=http://localhost:8080 npm run test:visual
const BASE_URL = process.env.TEST_URL || 'https://1597circle.github.io/SPOO/';

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false, // 같은 사이트에 동시 요청 몰리는 것 방지 (지역 JSON 지연로드 등)
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

  // 스크린샷 비교 허용 오차: 폰트 렌더링 등 미세한 차이로 매번 실패하지 않도록 약간의 여유를 둡니다.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
});
