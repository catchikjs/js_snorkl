import { test, expect } from "@playwright/test";

test("a student's QR only opens their assigned class; other-class, stopped and broken links show an access notice", async ({
  page,
  browser,
}) => {
  const teacher = await browser.newContext();
  const command = async (op, p = {}) => {
    const response = await teacher.request.post("/__classroom", {
      data: { op, p },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).value;
  };
  try {
    await command("teacher-login", { password: "browser-test-teacher" });
    const [source] = await command("library");
    const { working, class_id } = await command("book", { book: source.id });
    const otherClass = "20000000-0000-4000-8000-000000000002";
    const title = "QR 학급 접근 검증";
    working.title = title;
    const book = await command("new", { class_id, title, working });
    await command("approve", { book, revision: 1, working });
    const own = await command("distribute", { book, class_id });
    const other = await command("distribute", { book, class_id: otherClass });
    const detailRequests = [];
    page.on("request", (request) => {
      if (
        !request.url().endsWith("/__classroom") ||
        request.method() !== "POST"
      )
        return;
      const { op, p } = request.postDataJSON();
      if (op === "detail") detailRequests.push(p.task);
    });
    const resolved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/__classroom") &&
        response.request().postDataJSON()?.op === "resolve",
    );
    await page.goto("/a/" + other.token);
    const rejected = await resolved;
    expect(rejected.status()).toBe(403);
    expect(await rejected.json()).toEqual({
      code: "distribution_access_denied",
      error:
        "접근할 수 없습니다. 이 QR은 해당 학급에 배정된 학생만 이용할 수 있습니다. 본인 학급에 배포된 QR을 이용해 주세요.",
    });
    const notice = page.getByRole("alertdialog", {
      name: "QR 접근 오류",
      exact: true,
    });
    await expect(notice).toContainText(
      "본인 학급에 배포된 QR을 이용해 주세요.",
    );
    await expect(page.locator(".ink")).toHaveCount(0);
    expect(detailRequests).not.toContain(other.task);
    const direct = await page.request.post("/__classroom", {
      data: { op: "detail", p: { task: other.task } },
    });
    expect(direct.ok()).toBe(false);
    expect((await direct.json()).value).toBeNull();
    await notice.getByRole("button", { name: "내 교실로 돌아가기" }).click();
    await expect(page).toHaveURL("/");
    await expect(notice).toHaveCount(0);

    await page.goto("/a/" + own.token);
    await expect(page.locator(".ink")).toBeVisible();
    await expect(notice).toHaveCount(0);
    expect(detailRequests).toContain(own.task);

    await command("toggle", { book, class_id, task: own.task });
    for (const token of [
      own.token,
      "00000000-0000-4000-8000-000000000000",
      "broken-qr",
    ]) {
      await page.goto("/a/" + token);
      await expect(notice).toContainText("사용할 수 없는 QR입니다.");
      await expect(notice).not.toContainText("해당 학급에 배정된 학생만");
      await expect(page.locator(".ink")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL("/");
    }

    await page.route("**/__classroom", (route) =>
      route.request().postDataJSON().op === "resolve"
        ? route.abort("failed")
        : route.continue(),
    );
    await page.goto("/a/" + own.token);
    await expect(notice).toContainText("연결 상태를 확인한 뒤");
    await expect(notice).not.toContainText("해당 학급에 배정된 학생만");
    await expect(page.locator(".ink")).toHaveCount(0);
  } finally {
    await teacher.close();
  }
});
