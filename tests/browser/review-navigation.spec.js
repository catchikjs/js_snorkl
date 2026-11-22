import { test, expect } from "@playwright/test";

const first = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";

async function prepare(browser, title) {
  const context = await browser.newContext();
  const command = async (op, p = {}) => {
    const response = await context.request.post("/__classroom", {
      data: { op, p },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).value;
  };
  await command("teacher-login", { password: "browser-test-teacher" });
  const [source] = await command("library");
  const { working } = await command("book", { book: source.id });
  working.title = title;
  const book = await command("new", { class_id: first, title, working });
  await command("approve", { book, revision: 1, working });
  const firstLink = await command("distribute", { book, class_id: first });
  const secondLink = await command("distribute", { book, class_id: second });
  return { context, page: await context.newPage(), firstLink, secondLink };
}

async function expectClassList(page, classroom) {
  await expect(
    page.getByRole("heading", { name: "제출·검토", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `${classroom}에 배포된 평가와 학생별 제출 기록을 확인하세요.`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "평가 목록", exact: false }),
  ).toHaveCount(0);
  await expect(page.locator("main .panel details > summary")).toHaveCount(0);
}

test("teacher keeps the review screen when switching class from the list, roster or an open submission", async ({
  page: studentPage,
  browser,
}) => {
  const title = "반별 제출 검토 전환";
  const { context, page } = await prepare(browser, title);
  try {
    // Save an actual class-1 answer; both classes receive the same evaluation title.
    await studentPage.goto("/");
    await studentPage.getByRole("button", { name: new RegExp(title) }).click();
    await studentPage.getByRole("button", { name: /문항 1.*필수/ }).click();
    await studentPage.getByLabel("풀이 설명").fill("1반에만 표시할 제출 답안");
    await studentPage
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await expect(
      studentPage.getByRole("button", { name: /1회차 원본/ }),
    ).toBeVisible();

    await page.goto("/");
    await page.getByRole("button", { name: "제출·검토", exact: true }).click();
    await expectClassList(page, "1학년 1반");
    await page.getByLabel("학급", { exact: true }).selectOption(second);
    await expectClassList(page, "1학년 2반");
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.locator("main .panel details > summary")).toHaveCount(1);
    await expect(page.locator("main .panel details > summary")).toContainText(
      "0026 연습 학생 26 · 미제출",
    );
    await expect(
      page.getByText("1학년 2반 ·", { exact: false }).first(),
    ).toBeVisible();

    await page.getByLabel("학급", { exact: true }).selectOption(first);
    await expectClassList(page, "1학년 1반");
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.locator("main .panel details > summary")).toHaveCount(25);
    await expect(
      page.locator("main .panel details > summary").filter({ hasText: "0026" }),
    ).toHaveCount(0);
    await page
      .locator("summary")
      .filter({ hasText: "0001 연습 학생 1" })
      .click();
    await page.getByRole("button", { name: /문항 1 · 1회차/ }).click();
    await expect(page.getByAltText("제출 풀이")).toBeVisible();
    await expect(
      page.getByText("1반에만 표시할 제출 답안", { exact: true }),
    ).toBeVisible();

    await page.getByLabel("학급", { exact: true }).selectOption(second);
    await expectClassList(page, "1학년 2반");
    await expect(page.getByAltText("제출 풀이")).toHaveCount(0);
    await expect(
      page.getByText("1반에만 표시할 제출 답안", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.locator("main .panel details > summary")).toHaveCount(1);
    await expect(page.locator("main .panel details > summary")).toContainText(
      "미제출",
    );
  } finally {
    await context.close();
  }
});

test("a late response for the previous class cannot reopen its evaluation after switching class", async ({
  browser,
}) => {
  const title = "늦은 반별 조회 응답";
  const { context, page, firstLink } = await prepare(browser, title);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requested;
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  try {
    await page.route("**/__classroom", async (route) => {
      const { op, p } = route.request().postDataJSON();
      if (op !== "detail" || p.task !== firstLink.task) return route.continue();
      const response = await route.fetch();
      requested();
      await gate;
      await route.fulfill({ response });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "제출·검토", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await started;
    await page.getByLabel("학급", { exact: true }).selectOption(second);
    await expectClassList(page, "1학년 2반");
    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/__classroom") &&
        response.request().postDataJSON()?.op === "detail",
    );
    release();
    await (await completed).finished();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expectClassList(page, "1학년 2반");
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.locator("main .panel details > summary")).toHaveCount(1);
    await expect(page.locator("main .panel details > summary")).toContainText(
      "0026 연습 학생 26",
    );
  } finally {
    release();
    await context.close();
  }
});
