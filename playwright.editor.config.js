import { defineConfig } from "@playwright/test";
import { prepareEditorEnvironment } from "./tests/editor/environment.js";

prepareEditorEnvironment();
export default defineConfig({
  testDir: "./tests/editor",
  workers: 1,
  outputDir: "test-results/editor",
  timeout: 180000,
  use: {
    actionTimeout: 15000,
    baseURL: "http://localhost:8788",
    viewport: { width: 1440, height: 1100 },
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
  webServer: [
    {
      command:
        "npm --prefix developer run build && node tests/editor/start-worker.js",
      url: "http://localhost:8788/login",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "VITE_DEVELOPER_URL=http://localhost:8788/ node node_modules/vite/bin/vite.js --host localhost --port 5175 --strictPort",
      url: "http://localhost:5175/echo_training-App/",
      reuseExistingServer: false,
    },
  ],
});
