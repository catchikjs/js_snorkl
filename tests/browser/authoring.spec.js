import { test, expect } from "@playwright/test";

async function enterTeacher(page) {
  await page.getByRole("button", { name: "교사 모드로 전환" }).click();
  const dialog = page.getByRole("dialog", { name: "교사 모드 비밀번호" });
  await dialog.getByLabel("비밀번호", { exact: true }).fill("browser-test-teacher");
  await dialog.getByRole("button", { name: "교사 모드로 전환" }).click();
  await expect(
    page.getByRole("button", { name: "학생 모드로 전환" }),
  ).toBeVisible();
}

test("teacher selects an authoring method, deletes and reorders questions, and uses a whole file page", async ({
  page,
}) => {
  await page.goto("/");
  await enterTeacher(page);
  await page
    .locator(".pagehead")
    .getByRole("button", { name: "평가 만들기", exact: true })
    .click();

  const chooser = page.getByRole("dialog", {
    name: "어떻게 문제를 만들까요?",
  });
  await expect(chooser).toBeVisible();
  await expect(
    chooser.getByRole("button", { name: /PDF 자동 문항 분할/ }),
  ).toBeDisabled();
  await expect(
    chooser.getByRole("button", { name: /교육과정 기반 AI 생성/ }),
  ).toBeDisabled();
  await chooser.getByRole("button", { name: /직접 입력/ }).click();

  const prompt = page.getByRole("textbox", { name: "문제 설명" });
  await prompt.fill("첫째 문제");
  await page.getByRole("button", { name: "＋ 문항" }).click();
  await prompt.fill("둘째 문제");
  await page.getByRole("button", { name: "＋ 문항" }).click();
  await prompt.fill("셋째 문제");

  await page.getByRole("button", { name: /^문항 2$/ }).click();
  await page.getByRole("button", { name: "현재 문항 삭제" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "2번 문항을 삭제할까요?" });
  await deleteDialog.getByRole("button", { name: "문항 삭제" }).click();
  await expect(page.getByRole("button", { name: /^문항 3/ })).toHaveCount(0);
  await expect(prompt).toHaveValue("셋째 문제");

  await page
    .getByRole("button", { name: "현재 문항을 앞으로 이동" })
    .click();
  await page.getByRole("button", { name: /^문항 1$/ }).click();
  await expect(prompt).toHaveValue("셋째 문제");

  await page.getByRole("button", { name: "출제 방식" }).click();
  await page
    .getByRole("dialog", { name: "어떻게 문제를 만들까요?" })
    .getByRole("button", { name: /파일 그대로 출제/ })
    .click();
  const wholeFile = page.getByRole("dialog", { name: "파일 그대로 출제" });
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent("<h1>WHOLE PAGE</h1><p>x² + y² = 1</p>");
  const pdf = await pdfPage.pdf();
  await pdfPage.close();
  await wholeFile.locator("input[type=file]").setInputFiles({
    name: "whole-question.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await wholeFile.getByRole("button", { name: "전체 페이지 미리보기" }).click();
  await expect(wholeFile.getByAltText("학생에게 보일 범위")).toBeVisible();
  await wholeFile.getByRole("button", { name: "현재 문항으로 사용" }).click();
  await expect(page.getByAltText("문제 자료 1")).toBeVisible();
});
