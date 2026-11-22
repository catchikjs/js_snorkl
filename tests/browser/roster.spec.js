import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";

const classId = (n) => "20000000-0000-4000-8000-" + String(n).padStart(12, "0");

async function openRoster(page, misplaced = false) {
  const requests = [];
  const members = [
    {
      uid: "existing",
      number: misplaced ? "10201" : "10101",
      label: "기존 학생",
      class_id: classId(1),
    },
  ];
  const failures = new Set();
  // Exercise the real component with a controlled account HTTP boundary.
  await page.route("**/src/api.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const demo = false;
      export const message = e => e.message;
      export const api = async (_,p) => (await fetch('/__roster_members?class_id='+p.class_id)).json();
      export const client = {functions:{invoke:async (_, {body}) => {
        const r = await fetch('/__roster_account', {method:'POST',body:JSON.stringify(body)});
        const data = await r.json();
        return r.ok ? {data} : {error:{context:{json:async()=>data}}};
      }}};`,
    }),
  );
  await page.route("**/__roster_members?*", (route) =>
    route.fulfill({
      json: members.filter(
        (m) =>
          m.class_id ===
          new URL(route.request().url()).searchParams.get("class_id"),
      ),
    }),
  );
  await page.route("**/__roster_account", (route) => {
    const p = route.request().postDataJSON();
    requests.push(p);
    if (p.number === "10202" && !failures.has(p.number)) {
      failures.add(p.number);
      return route.fulfill({
        status: 503,
        json: { error: "배정 연결 실패 · 다시 시도하세요." },
      });
    }
    const existing = members.find((m) => m.number === p.number);
    const moved = !!existing && existing.class_id !== p.class_id;
    if (existing) existing.class_id = p.class_id;
    if (!existing)
      members.push({
        uid: p.id,
        number: p.number,
        label: p.label,
        class_id: p.class_id,
      });
    return route.fulfill({
      json: {
        value: {
          registered: true,
          already_registered: !!existing,
          moved,
          assigned_tasks: 2,
        },
      },
    });
  });
  await page.route("**/__roster_test*", (route) =>
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

test("whole-grade upload routes all 137 rows to their classes and validates edits before registration", async ({
  page,
}) => {
  const requests = await openRoster(page);
  const counts = [18, 20, 20, 20, 19, 20, 20];
  const csv =
    "학번,이름,학급,초기비밀번호\n" +
    counts
      .flatMap((n, i) =>
        Array.from(
          { length: n },
          (_, j) =>
            `10${i + 1}${String(j + 1).padStart(2, "0")},${i === 0 && j === 0 ? "기존 학생" : "가상 학생"},1학년 ${i + 1}반,abcdef`,
        ),
      )
      .join("\n");
  await page.getByLabel("학생 명부 파일").setInputFiles({
    name: "전체학년.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(
    page.getByText(/학급별 처리 예정: 1학년 1반 18명/),
  ).toBeVisible();
  await expect(page.getByLabel("137행 학급", { exact: true })).toHaveValue(
    "1학년 7반",
  );
  await page.getByLabel("2행 학급", { exact: true }).selectOption("1학년 2반");
  await page.getByRole("button", { name: "137명 등록·배정" }).click();
  await expect(
    page.getByText(/2행: 학번 앞 세 자리와 학급이 일치하지 않습니다/),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByLabel("2행 학급", { exact: true }).selectOption("1학년 1반");
  await page.getByRole("button", { name: "137명 등록·배정" }).click();
  await expect(
    page.getByText("137명 중 136명 처리 완료.", { exact: false }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "1명 등록·배정" }).click();
  await expect(
    page.getByRole("button", { name: "처리 완료", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "등록된 학생 18명" }),
  ).toBeVisible();
  expect(
    requests.every((p) => p.class_id === classId(Number(p.number.slice(1, 3)))),
  ).toBe(true);
  expect(new Set(requests.map((p) => p.number)).size).toBe(137);
});

test("a misplaced existing student previews the move and preserves the password", async ({
  page,
}) => {
  const requests = await openRoster(page, true);
  await page.getByLabel("학생 명부 파일").setInputFiles({
    name: "수정.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("10201,기존 학생,1학년 2반,\n"),
  });
  await expect(
    page.getByText(/소속 수정 예정: 1학년 1반 → 1학년 2반/),
  ).toBeVisible();
  await expect(page.getByLabel("1행 초기 비밀번호")).toBeDisabled();
  await page.getByRole("button", { name: "1명 등록·배정" }).click();
  await expect(page.getByText(/소속 수정 완료 · 비밀번호 유지/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "등록된 학생 0명" }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    op: "enrollClassRoster",
    class_id: classId(2),
    class_name: "1학년 2반",
    password: "",
  });
});

test("Excel roster preview registers and assigns once, preserves existing passwords and retries only failed rows", async ({
  page,
}) => {
  const requests = await openRoster(page);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("명부");
  sheet.addRows([
    ["학번", "이름", "학급", "초기비밀번호"],
    ["10102", "새 학생", "1학년 1반", " abcdef "],
    ["10101", "기존 학생", "1학년 1반", ""],
    ["10202", "재시도 학생", "1학년 2반", "ghijkl"],
  ]);
  await page.getByLabel("학생 명부 파일").setInputFiles({
    name: "학생명부.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await expect(page.getByLabel("1행 학번")).toHaveValue("10102");
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
    page.getByRole("heading", { name: "등록된 학생 2명" }),
  ).toBeVisible();
  expect(requests.map((p) => p.number)).toEqual([
    "10102",
    "10101",
    "10202",
    "10202",
  ]);
  expect(requests[2].id).toBe(requests[3].id);
  expect(requests[0].password).toBe(" abcdef ");
  expect(
    requests.every(
      (p) =>
        p.op === "enrollClassRoster" &&
        p.class_id === classId(Number(p.number.slice(1, 3))),
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
  expect(workbook.worksheets[0].getRow(1).values.slice(1)).toEqual([
    "학번",
    "이름",
    "학급",
    "초기비밀번호",
  ]);
  await page.getByLabel("학생 명부 파일").setInputFiles({
    name: "명부.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      '\uFEFF학번,이름,학급,초기비밀번호\r\n10103,"김,학생",101,abcdef\r\n',
    ),
  });
  await expect(page.getByLabel("1행 이름")).toHaveValue("김,학생");
  await page.getByLabel("학생 명부 파일").setInputFiles({
    name: "중복.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("10103,중복,101,abcdef\n"),
  });
  await expect(
    page.getByText("입력표에 이미 있는 학번이 포함돼 있습니다.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("1행 이름")).toHaveValue("김,학생");
  expect(requests).toHaveLength(0);
});

test("class buttons filter registered students without discarding input and reset only the selected student's password", async ({
  page,
}) => {
  await openRoster(page);
  const students = [
    {
      uid: "30000000-0000-4000-8000-000000000001",
      number: "10101",
      label: "첫 반 학생",
      class_id: classId(1),
    },
    {
      uid: "30000000-0000-4000-8000-000000000026",
      number: "10201",
      label: "둘째 반 학생",
      class_id: classId(2),
    },
    {
      uid: "30000000-0000-4000-8000-000000000027",
      number: "10202",
      label: "다른 학생",
      class_id: classId(2),
    },
  ];
  await page.route("**/__roster_members?*", (route) =>
    route.fulfill({
      json: students.filter(
        (m) =>
          m.class_id ===
          new URL(route.request().url()).searchParams.get("class_id"),
      ),
    }),
  );
  const resets = [];
  let fail = true;
  await page.route("**/__roster_account", (route) => {
    resets.push(route.request().postDataJSON());
    return fail
      ? route.fulfill({
          status: 503,
          json: { error: "연결을 확인하고 같은 비밀번호로 다시 시도하세요." },
        })
      : route.fulfill({
          json: { value: { reset: true, uid: students[1].uid } },
        });
  });
  await page.reload();
  const list = page.getByRole("region", { name: "등록된 학생 1명" });
  await expect(
    list.getByRole("cell", { name: "첫 반 학생", exact: true }),
  ).toBeVisible();
  await page.getByLabel("1행 이름", { exact: true }).fill("입력 중인 명부");
  const filters = page.getByRole("group", { name: "등록 학생 학급 선택" });
  await filters
    .getByRole("button", { name: "1학년 2반 2명", exact: true })
    .click();
  const second = page.getByRole("region", { name: "등록된 학생 2명" });
  await expect(
    second.getByRole("cell", { name: "둘째 반 학생", exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("cell", { name: "첫 반 학생", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("1행 이름", { exact: true })).toHaveValue(
    "입력 중인 명부",
  );
  await filters
    .getByRole("button", { name: "1학년 3반 0명", exact: true })
    .click();
  await expect(
    page.getByText("1학년 3반에 등록된 학생이 없습니다.", { exact: true }),
  ).toBeVisible();
  await filters
    .getByRole("button", { name: "1학년 2반 2명", exact: true })
    .click();
  await second.scrollIntoViewIfNeeded();
  await second.screenshot({ path: "/private/tmp/goodmath-roster-classes.png" });
  const open = second.getByRole("button", {
    name: "10201 둘째 반 학생 비밀번호 초기화",
    exact: true,
  });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "학생 비밀번호 초기화" });
  await expect(dialog).toContainText("10201 · 둘째 반 학생");
  await expect(dialog).toContainText("1학년 2반");
  await dialog
    .getByLabel("새 비밀번호", { exact: true })
    .fill("student-new-password");
  await dialog
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("different-password");
  await dialog
    .getByRole("button", { name: "비밀번호 초기화", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("서로 다릅니다");
  expect(resets).toHaveLength(0);
  await dialog
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("student-new-password");
  await dialog
    .getByRole("button", { name: "비밀번호 초기화", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("연결을 확인");
  expect(resets).toHaveLength(1);
  fail = false;
  await dialog
    .getByRole("button", { name: "비밀번호 초기화", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".notice-toast")).toContainText(
    "비밀번호를 초기화했습니다",
  );
  expect(resets).toHaveLength(2);
  expect(resets[1]).toEqual({
    op: "resetStudentPassword",
    class_id: classId(2),
    uid: students[1].uid,
    password: "student-new-password",
  });
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("student-new-password");
  await open.click();
  await expect(dialog.getByLabel("새 비밀번호", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    dialog.getByLabel("새 비밀번호 확인", { exact: true }),
  ).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({
    path: "/private/tmp/goodmath-student-password.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(resets).toHaveLength(2);
});
