import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  // Both suites render textured bodies with software WebGL.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173/echo_training-App/",
    viewport: { width: 1440, height: 1050 },
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROME_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
        : {}),
      args: [
        "--enable-webgl",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1",
    url: "http://127.0.0.1:4173/echo_training-App/",
    reuseExistingServer: !process.env.CI,
  },
});
