import { test, expect } from "@playwright/test";

for (const screen of ["draft", "submitted"]) {
  test(`teacher cancels one class, closes the student's ${screen} view, and resumes without losing answers`, async ({
    page,
    browser,
  }) => {
    const title = `배포 취소 ${screen}`;
    const teacher = await browser.newContext(),
      teacherPage = await teacher.newPage();
    const command = async (op, p = {}) => {
      const res = await teacher.request.post("/__classroom", {
        data: { op, p },
      });
      expect(res.ok()).toBe(true);
      return (await res.json()).value;
    };
    try {
      await command("teacher-login", { password: "browser-test-teacher" });
      const [source] = await command("library");
      const { working, class_id } = await command("book", { book: source.id });
      working.title = title;
      const book = await command("new", { class_id, title, working });
      await command("approve", { book, revision: 1, working });
      const link = await command("distribute", { book, class_id });
      const home = await command("home");
      const other = home.classes.find((c) => c.id !== class_id);
      await command("distribute", { book, class_id: other.id });
      await page.goto("/");
      await page.getByRole("button", { name: new RegExp(title) }).click();
      await page.getByRole("button", { name: /문항 1.*필수/ }).click();
      await page.getByLabel("풀이 설명").fill("취소 후에도 보존할 답안");
      await expect(
        page.getByText("서버 저장 완료", { exact: true }),
      ).toBeVisible();
      if (screen === "submitted") {
        await page.getByRole("button", { name: "제출하기" }).click();
        await page.getByRole("button", { name: /1회차 원본/ }).click();
        await expect(page.getByAltText("제출 풀이")).toBeVisible();
      }
      await teacherPage.goto("/");
      await teacherPage
        .getByRole("button", { name: title + " 확정", exact: true })
        .click();
      await teacherPage
        .getByRole("main")
        .getByRole("button", { name: "학급별 배포", exact: true })
        .click();
      const card = teacherPage.getByRole("group", {
        name: "1학년 1반 배포 버전 1",
        exact: true,
      });
      await card
        .getByRole("button", { name: "배포 취소", exact: true })
        .click();
      const dialog = teacherPage.getByRole("dialog", {
        name: "학급 배포 취소",
      });
      await expect(dialog).toContainText("이미 제출된 답안은 보관");
      await dialog.getByRole("button", { name: "돌아가기" }).click();
      expect(
        (await command("book", { book })).links.find(
          (l) => l.task === link.task,
        ).withdrawn_at,
      ).toBeNull();
      await card
        .getByRole("button", { name: "배포 취소", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "배포 취소하기", exact: true })
        .click();
      await expect(card).toContainText("배포 취소됨");
      await expect(
        card.getByRole("button", { name: "링크 복사" }),
      ).toBeDisabled();
      await expect(
        teacherPage.getByRole("group", {
          name: "1학년 2반 배포 버전 1",
          exact: true,
        }),
      ).toContainText("배포 중");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        page.getByRole("heading", { name: "나의 학습 보드" }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toContainText(
        "배포가 취소되었거나",
      );
      await expect(
        page.getByRole("button", { name: new RegExp(title) }),
      ).toHaveCount(0);
      await expect(page.locator(".ink")).toHaveCount(0);
      await expect(page.getByAltText("제출 풀이")).toHaveCount(0);
      expect(
        (
          await page.request.post("/__classroom", {
            data: { op: "detail", p: { task: link.task } },
          })
        ).ok(),
      ).toBe(false);
      await card
        .getByRole("button", { name: "배포 재개", exact: true })
        .click();
      await expect(card).toContainText("배포 중");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.getByRole("button", { name: new RegExp(title) }).click();
      if (screen === "submitted") {
        await page.getByRole("button", { name: /1회차 원본/ }).click();
        await expect(page.getByAltText("제출 풀이")).toBeVisible();
        await expect(
          page.getByText("취소 후에도 보존할 답안", { exact: true }),
        ).toBeVisible();
      } else {
        await page.getByRole("button", { name: /문항 1.*필수/ }).click();
        await expect(page.getByLabel("풀이 설명")).toHaveValue(
          "취소 후에도 보존할 답안",
        );
      }
      const restored = (await command("book", { book })).links.find(
        (l) => l.class_id === class_id,
      );
      expect(restored.task).toBe(link.task);
    } finally {
      await teacher.close();
    }
  });
}
