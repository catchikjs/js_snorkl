import { test, expect } from "@playwright/test";

test("teacher sees saved student ink, pages and photos before submission, with class isolation and live updates", async ({
  page: student,
  browser,
}) => {
  const context = await browser.newContext();
  const teacher = await context.newPage();
  const command = async (op, p = {}) => {
    const response = await context.request.post("/__classroom", {
      data: { op, p },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).value;
  };
  try {
    await command("teacher-login", { password: "browser-test-teacher" });
    const [source] = await command("library");
    const { working, class_id } = await command("book", { book: source.id });
    const title = "수업 중 노트 확인";
    working.title = title;
    working.questions.push(structuredClone(working.questions[0]));
    const book = await command("new", { class_id, title, working });
    await command("approve", { book, revision: 1, working });
    const link = await command("distribute", { book, class_id });
    const second = "20000000-0000-4000-8000-000000000002";
    await command("distribute", { book, class_id: second });

    await teacher.goto("/");
    await teacher
      .getByRole("button", { name: "제출·검토", exact: true })
      .click();
    await teacher.getByRole("button", { name: new RegExp(title) }).click();
    await teacher
      .getByRole("button", { name: "실시간 노트", exact: true })
      .click();
    const board = teacher.getByRole("region", { name: "학급 실시간 노트" });
    await expect(board.locator(".live-card")).toHaveCount(25);
    await expect(
      board.locator(".live-card").filter({ hasText: "연습 학생 26" }),
    ).toHaveCount(0);

    await student.goto("/a/" + link.token);
    await expect(student.locator(".ink")).toBeVisible();
    await expect(
      student.getByText(
        "서버에 저장된 작성 중 노트는 담당 교사가 확인할 수 있습니다.",
      ),
    ).toBeVisible();
    const area = await student.locator(".ink").boundingBox();
    await student.mouse.move(area.x + 40, area.y + 40);
    await student.mouse.down();
    await student.mouse.move(area.x + 170, area.y + 100, { steps: 8 });
    await student.mouse.up();
    await student
      .getByLabel("풀이 설명", { exact: true })
      .fill("제출 전 교사가 확인할 수 있는 풀이");
    await expect(
      student.getByText("서버 저장 완료", { exact: true }),
    ).toBeVisible();
    const card = board.getByRole("button", {
      name: "0001 연습 학생 1 · 초안 있음 · 노트 열기",
      exact: true,
    });
    await expect(card).toContainText("제출 전 교사가 확인할 수 있는 풀이");
    await expect(
      card.getByRole("img", { name: "0001 연습 학생 1 노트 미리보기" }),
    ).toBeVisible();
    const pixels = await card.locator("canvas").evaluate((canvas) => {
      const data = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 130) dark++;
      return dark;
    });
    expect(pixels).toBeGreaterThan(10);
    await teacher.screenshot({ path: "/private/tmp/goodmath-live-notes-class.png", fullPage: false });
    await card.click();
    const note = teacher.getByRole("dialog", {
      name: "0001 연습 학생 1 · 문항 1 노트",
      exact: true,
    });
    await expect(note).toContainText("제출 전 교사가 확인할 수 있는 풀이");
    await expect(note.getByRole("textbox")).toHaveCount(0);

    await student.bringToFront();
    await student.getByRole("button", { name: "페이지", exact: true }).click();
    await student
      .getByLabel("풀이 설명", { exact: true })
      .fill("두 번째 페이지까지 저장");
    await student
      .getByLabel("풀이 사진 · JPG / PNG")
      .setInputFiles({
        name: "note.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL7vM8AAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await expect(
      student.getByText("서버 저장 완료", { exact: true }),
    ).toBeVisible();
    await expect(note).toContainText("두 번째 페이지까지 저장");
    await expect(note.getByRole("img", { name: /노트 [12]쪽/ })).toHaveCount(2);
    await expect(note.getByAltText("풀이 사진 1")).toBeVisible();
    await note.getByRole("button", { name: "닫기", exact: true }).click();
    await board
      .getByRole("button", { name: "이름 가리기", exact: true })
      .click();
    await expect(
      board.getByRole("button", {
        name: "학생 1 · 초안 있음 · 노트 열기",
        exact: true,
      }),
    ).toBeVisible();
    await expect(board.getByText("연습 학생 1", { exact: false })).toHaveCount(
      0,
    );

    await board.getByLabel("노트 문항").selectOption({ label: "문항 2" });
    await expect(
      board.getByRole("button", {
        name: "학생 1 · 미작성 · 노트 열기",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      board.getByText("두 번째 페이지까지 저장", { exact: true }),
    ).toHaveCount(0);
    await board.getByLabel("노트 문항").selectOption({ label: "문항 1" });
    await expect(
      board.getByRole("button", {
        name: "학생 1 · 초안 있음 · 노트 열기",
        exact: true,
      }),
    ).toBeVisible();
    await student
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await expect(
      student.getByRole("button", { name: /1회차 원본/ }),
    ).toBeVisible();
    await expect(
      board.getByRole("button", {
        name: "학생 1 · 제출 완료 · 노트 열기",
        exact: true,
      }),
    ).toBeVisible();
    await board
      .getByRole("button", {
        name: "학생 1 · 제출 완료 · 노트 열기",
        exact: true,
      })
      .click();
    await teacher
      .getByRole("dialog")
      .getByRole("button", { name: "제출한 답안 검토" })
      .click();
    await expect(teacher.getByAltText("제출 풀이").first()).toBeVisible();

    await teacher.getByLabel("학급", { exact: true }).selectOption(second);
    await teacher.getByRole("button", { name: new RegExp(title) }).click();
    await teacher
      .getByRole("button", { name: "실시간 노트", exact: true })
      .click();
    await expect(board.locator(".live-card")).toHaveCount(1);
    await expect(board.locator(".live-card")).toContainText(
      "0026 연습 학생 26",
    );
    await expect(
      board.getByText("두 번째 페이지까지 저장", { exact: true }),
    ).toHaveCount(0);
    const requests = [];
    teacher.on("request", (r) => {
      if (
        r.url().endsWith("/__classroom") &&
        r.postDataJSON()?.op === "liveNotes"
      )
        requests.push(r);
    });
    await board
      .getByRole("button", { name: "자동 갱신 켜짐", exact: true })
      .click();
    await expect(board.locator(".live-card")).toHaveCount(1);
    const count = requests.length;
    await teacher.waitForTimeout(3500); // Observe a full refresh interval while paused.
    expect(requests).toHaveLength(count);
    await teacher.screenshot({
      path: "/private/tmp/goodmath-live-notes.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
