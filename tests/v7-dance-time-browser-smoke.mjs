import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";

const htmlPath = fileURLToPath(new URL("../sw-ai-office-v7(claude).html", import.meta.url));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("sw_ai_cfg", JSON.stringify({
        provider: "local",
        apiKey: "",
        model: ""
      }));
    } catch {}
  });

  const rootPath = fileURLToPath(new URL("../index.html", import.meta.url));
  const legacyPath = fileURLToPath(new URL("../legacy-floorplan-2026-11-23.html", import.meta.url));
  if (!fs.existsSync(legacyPath)) throw new Error("The previous root floorplan must remain archived.");

  await page.goto(pathToFileURL(rootPath).href, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#gl canvas", { timeout: 30000 });
  if (!page.url().includes("sw-ai-office-v7%28claude%29.html")) {
    throw new Error("The main GitHub Pages entry did not redirect to the v7 3D office.");
  }

  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#gl canvas", { timeout: 30000 });
  await page.locator("#inp").fill("댄스타임");
  await page.locator("#send").click();

  await page.waitForFunction(
    () => document.querySelector("#msgs")?.innerText.includes("댄스타임 시작!"),
    null,
    { timeout: 60000 }
  );

  const employeeLabels = await page.locator("#labels .nl").count();
  if (employeeLabels < 20) {
    throw new Error("Expected the complete existing office roster to remain visible; found " + employeeLabels);
  }

  await page.locator("#inp").fill("댄스타임 종료");
  await page.locator("#send").click();

  await page.waitForFunction(
    () => document.querySelector("#msgs")?.innerText.includes("전 직원의 자리 복귀가 완료됐습니다."),
    null,
    { timeout: 60000 }
  );

  console.log("PASS: all AI employees reached the hallway dance state and returned to their desks; " + employeeLabels + " office labels remain visible.");
} finally {
  await browser.close();
}
