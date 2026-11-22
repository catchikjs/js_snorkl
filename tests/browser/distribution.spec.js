import { test, expect } from "@playwright/test";

for (const update of ["timer", "focus", "visibilitychange", "online"]) {
  test(`an empty student task list receives its first distribution on ${update}`, async ({ page, browser }) => {
    const title = `첫 배포 ${update}`;
    // Isolate this student's visible task list from the shared demo seed.
    await page.route("**/__classroom", async (route) => {
      if (route.request().postDataJSON().op !== "home") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.value.tasks = body.value.tasks.filter((t) => t.title === title);
      await route.fulfill({ response, json: body });
    });
    await page.clock.install();
    await page.goto("/");
    await expect(page.getByText("표시할 평가가 없습니다.").first()).toBeVisible();

    const teacher = await browser.newContext();
    const command = async (op, p = {}) => {
      const response = await teacher.request.post("/__classroom", { data: { op, p } });
      expect(response.ok()).toBe(true);
      return (await response.json()).value;
    };
    try {
      await command("teacher-login", { password: "browser-test-teacher" });
      const [source] = await command("library");
      const { working, class_id } = await command("book", { book: source.id });
      working.title = title;
      const book = await command("new", { class_id, title, working });
      await command("approve", { book, revision: 1, working });
      const link = await command("distribute", { book, class_id });
      if (update === "timer") await page.clock.runFor(31000);
      else await page.evaluate((event) => {
        (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event));
      }, update);
      await page.getByRole("button", { name: new RegExp(title) }).click({ timeout: 5000 });
      await page.getByRole("button", { name: /문항 1.*필수/ }).click();
      await expect(page.locator(".ink")).toBeVisible();
      const detail = await page.request.post("/__classroom", {
        data: { op: "detail", p: { task: link.task } },
      });
      expect(detail.ok()).toBe(true);
    } finally {
      await teacher.close();
    }
  });
}
