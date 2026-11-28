import {defineConfig} from "playwright/test";
// UI_ACCEPTANCE_PORT lets two checkouts run the lane on one machine.
const port=Number(process.env.UI_ACCEPTANCE_PORT??4189);
export default defineConfig({
  testDir:".",testMatch:"*.spec.mjs",fullyParallel:false,retries:0,
  reporter:"list",use:{baseURL:`http://127.0.0.1:${port}`,trace:"retain-on-failure",
    launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:undefined},
  webServer:{command:"node server.mjs",url:`http://127.0.0.1:${port}`,reuseExistingServer:false},
  projects:[{name:"chromium",use:{browserName:"chromium"}}]
});
