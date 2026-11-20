import { test, expect } from "@playwright/test";
test("student handwriting → immutable receipt → manual review → feedback-only release", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "과제 열기" }).click();
  await page.getByRole("button", { name: /문항 1.*필수/ }).click();
  const ink = page.locator(".ink");
  await expect(ink).toBeVisible();
  const b = await ink.boundingBox();
  await page.mouse.move(b.x + 50, b.y + 50);
  await page.mouse.down();
  await page.mouse.move(b.x + 140, b.y + 90, { steps: 6 });
  await page.mouse.up();
  await page.getByLabel("풀이 설명").fill("변수의 역할을 바꾸었습니다.");
  await expect(page.getByText("서버 저장 완료", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "과제 열기" }).click();
  await page.getByRole("button", { name: /문항 1.*필수/ }).click();
  await expect(page.getByLabel("풀이 설명")).toHaveValue(
    "변수의 역할을 바꾸었습니다.",
  );
  await page.getByRole("button", { name: "제출하기" }).click();
  await expect(page.getByRole("button", { name: /1회차 원본/ })).toBeVisible();
  await page.getByRole("button", { name: "교사 모드로 전환" }).click();
  await page.getByRole("button", { name: "제출·검토", exact: true }).click();
  await page.getByRole("button", { name: /역함수의 식 구하기/ }).click();
  await page.locator("summary").filter({ hasText: "0001" }).click();
  await page.getByRole("button", { name: /문항 1 · 1회차/ }).click();
  await expect(page.getByAltText("제출 풀이")).toBeVisible();
  await page.locator("input[type=number]").fill("8");
  await page
    .getByRole("textbox", { name: "잘한 점", exact: true })
    .fill("변수 교환을 잘 표현했습니다.");
  await page.getByLabel("확정 사유").fill("필기 원본을 확인했습니다.");
  await page.getByRole("button", { name: "평가 확정" }).click();
  await page.getByRole("button", { name: "선택한 결과 공개" }).click();
  await expect(
    page.getByText("선택한 항목을 학생에게 공개했습니다."),
  ).toBeVisible();
  await page.getByRole("button", { name: "학생 모드로 전환" }).click();
  await page.getByRole("button", { name: "피드백", exact: true }).click();
  await expect(page.getByText("변수 교환을 잘 표현했습니다.")).toBeVisible();
  await expect(page.getByText("공개 점수", { exact: true })).toHaveCount(0);
});
test("teacher edits a formula, crops a rotated PDF and opens class QR", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "교사 모드로 전환" }).click();
  await page.getByRole("button", { name: "역함수의 식 구하기 확정" }).click();
  await page.getByRole("button", { name: "파일 · 영역 가져오기" }).click();
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent("<h1>FUNCTION</h1><p>x + 2</p>");
  const pdf = await pdfPage.pdf();
  await pdfPage.close();
  await page.locator("input[type=file]").setInputFiles({
    name: "question.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(
    page.getByRole("button", { name: "선택 범위 미리보기" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "회전", exact: true }).click();
  await page.getByRole("button", { name: /확대 1×/ }).click();
  await expect(
    page.getByRole("button", { name: "선택 범위 미리보기" }),
  ).toBeEnabled();
  const crop = page.locator(".crop canvas");
  await crop.scrollIntoViewIfNeeded();
  const box = await crop.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 120, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "선택 범위 미리보기" }).click();
  const previewSize = await page
    .locator(".preview")
    .evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  const originalSize = await crop.evaluate((c) => [c.width, c.height]);
  expect(
    Math.abs(previewSize[0] - (originalSize[0] * 130) / box.width),
  ).toBeLessThan(4);
  expect(
    Math.abs(previewSize[1] - (originalSize[1] * 90) / box.height),
  ).toBeLessThan(4);
  await page.getByRole("button", { name: "현재 문항에 넣기" }).click();
  await expect(page.getByAltText("문제 자료 1")).toBeVisible();
  await page.getByRole("button", { name: "ƒ 수식" }).first().click();
  await page.getByRole("dialog").locator("textarea").fill("\\frac{x-1}{2}");
  await page.getByRole("button", { name: "적용", exact: true }).click();
  await page.getByRole("button", { name: "임시 저장" }).click();
  await expect(page.getByText("저장했습니다.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "답안·루브릭", exact: true }).click();
  await page.getByRole("button", { name: "최종 확정" }).click();
  await page.getByRole("button", { name: "선택 학급에 배포" }).click();
  await page.getByRole("button", { name: "QR 보기" }).last().click();
  await expect(page.getByAltText("학급 배포 링크 QR")).toBeVisible();
});
test("offline submission is queued and delivered once after reconnect", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /이차방정식의 두 근/ }).click();
  await page.getByRole("button", { name: /문항 1.*필수/ }).click();
  await expect(page.locator(".ink")).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel("풀이 설명").fill("두 인수의 곱으로 정리했습니다.");
  await page.getByRole("button", { name: "제출하기" }).click();
  await expect(
    page.getByRole("button", { name: "대기 제출 재시도" }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: /1회차 원본/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /2회차 원본/ })).toHaveCount(0);
});
test("pen-only touch filter, finger ink, undo and redo preserve canvas pixels", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /두 집합의 교집합/ }).click();
  await page.getByRole("button", { name: /문항 1.*필수/ }).click();
  const c = page.locator(".ink");
  await expect(c).toBeVisible();
  await c.scrollIntoViewIfNeeded();
  const pixels = () => c.evaluate((c) => c.toDataURL()),
    before = await pixels(),
    rect = await c.boundingBox();
  await page.touchscreen.tap(rect.x + 30, rect.y + 30);
  expect(await pixels()).toBe(before);
  await page.getByRole("button", { name: "손가락", exact: true }).click();
  await c.scrollIntoViewIfNeeded();
  const r = await c.boundingBox();
  await page.touchscreen.tap(r.x + 30, r.y + 30);
  await expect.poll(pixels).not.toBe(before);
  const after = await pixels();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect.poll(pixels).toBe(before);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect.poll(pixels).toBe(after);
});
