import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";

async function openRoster(page) {
  const requests = [];
  const members = [{ uid: "existing", number: "0001", label: "기존 학생" }];
  const failures = new Set();
  // Exercise the real component with a controlled account HTTP boundary.
  await page.route("**/src/api.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const demo = false;
      export const message = e => e.message;
      export const api = async () => (await fetch('/__roster_members')).json();
      export const client = {functions:{invoke:async (_, {body}) => {
        const r = await fetch('/__roster_account', {method:'POST',body:JSON.stringify(body)});
        const data = await r.json();
        return r.ok ? {data} : {error:{context:{json:async()=>data}}};
      }}};`,
    }),
  );
  await page.route("**/__roster_members", (route) =>
    route.fulfill({ json: members }),
  );
  await page.route("**/__roster_account", (route) => {
    const p = route.request().postDataJSON();
    requests.push(p);
    if (p.number === "00102" && !failures.has(p.number)) {
      failures.add(p.number);
      return route.fulfill({
        status: 503,
        json: { error: "배정 연결 실패 · 다시 시도하세요." },
      });
    }
    const existing = members.some((m) => m.number === p.number);
    if (!existing)
      members.push({ uid: p.id, number: p.number, label: p.label });
    return route.fulfill({
      json: {
        value: {
          registered: true,
          already_registered: existing,
          assigned_tasks: 2,
        },
      },
    });
  });
  await page.route("**/__roster_test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="ko"><meta charset="utf-8"><div id="app"></div><script type="module" src="/tests/browser/roster-harness.js"></script></html>',
    }),
  );
  await page.goto("/__roster_test");
  await expect(
    page.getByRole("heading", { name: "등록된 학생 1명" }),
  ).toBeVisible();
  return requests;
}

test("Excel roster preview registers and assigns once, preserves existing passwords and retries only failed rows", async ({
  page,
}) => {
  const requests = await openRoster(page);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("명부");
  sheet.addRows([
    ["학번", "이름", "초기 비밀번호"],
    ["00101", "새 학생", " abcdef "],
    ["0001", "기존 학생", ""],
    ["00102", "재시도 학생", "ghijkl"],
  ]);
  await page.getByLabel("학생 명부 파일").setInputFiles({
    name: "학생명부.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await expect(page.getByLabel("1행 학번")).toHaveValue("00101");
  await expect(page.getByLabel("1행 초기 비밀번호")).toHaveAttribute(
    "type",
    "password",
  );
  await expect(page.getByLabel("2행 초기 비밀번호")).toBeDisabled();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "3명 등록·배정" }).click();
  await expect(
    page.getByText("3명 중 2명 처리 완료.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("1행 초기 비밀번호")).toHaveValue("");
  await expect(page.getByLabel("3행 초기 비밀번호")).toHaveValue("ghijkl");
  await page.getByRole("button", { name: "1명 등록·배정" }).click();
  await expect(
    page.getByRole("button", { name: "처리 완료", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "등록된 학생 3명" }),
  ).toBeVisible();
  expect(requests.map((p) => p.number)).toEqual([
    "00101",
    "0001",
    "00102",
    "00102",
  ]);
  expect(requests[2].id).toBe(requests[3].id);
  expect(requests[0].password).toBe(" abcdef ");
  expect(
    requests.every(
      (p) =>
        p.op === "enrollRoster" &&
        p.class_id === "20000000-0000-4000-8000-000000000001",
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("abcdef");
});

test("CSV errors keep the preview intact and the downloadable Excel template is usable", async ({
  page,
}) => {
  const requests = await openRoster(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "엑셀 양식 다운로드" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("학생_명부_양식.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await file.path());
  expect(workbook.worksheets[0].getCell("A1").value).toBe("학번");
  await page.getByLabel("학생 명부 파일").setInputFiles({
    name: "명부.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      '\uFEFF학번,이름,초기 비밀번호\r\n00103,"김,학생",abcdef\r\n',
    ),
  });
  await expect(page.getByLabel("1행 이름")).toHaveValue("김,학생");
  await page.getByLabel("학생 명부 파일").setInputFiles({
    name: "중복.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("00103,중복,abcdef\n"),
  });
  await expect(
    page.getByText("입력표에 이미 있는 학번이 포함돼 있습니다.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("1행 이름")).toHaveValue("김,학생");
  expect(requests).toHaveLength(0);
});
