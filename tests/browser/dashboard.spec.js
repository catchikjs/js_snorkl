import { test, expect } from "@playwright/test";

test.use({ actionTimeout: 10000 });

test("class dashboard opens any student, preserves the overview on return and analyzes only the latest confirmed submission", async ({
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
    const title = "학급 통합 대시보드 검증";
    working.title = title;
    working.questions[0].points = 10;
    working.questions[0].private.criteria = [
      {
        id: "reason",
        label: [{ type: "text", text: "풀이 과정" }],
        max: 10,
        standard: [],
        partial: [],
      },
    ];
    working.questions.push(structuredClone(working.questions[0]));
    working.questions[1].public.required = false;
    const book = await command("new", { class_id, title, working });
    await command("approve", { book, revision: 1, working });
    const link = await command("distribute", { book, class_id });
    const otherClass = "20000000-0000-4000-8000-000000000002";
    await command("distribute", { book, class_id: otherClass });
    await teacher.goto("/");
    await teacher
      .getByRole("button", { name: "제출·검토", exact: true })
      .click();
    await teacher.getByRole("button", { name: new RegExp(title) }).click();
    await teacher
      .getByRole("button", { name: "진행률 대시보드", exact: true })
      .click();
    const board = teacher.getByRole("region", {
      name: "학급 진행률 대시보드",
      exact: true,
    });
    await expect(board.locator("tbody tr")).toHaveCount(25);
    const scroller = board.getByRole("region", {
      name: "학급 전체 문항별 진행표",
    });
    await scroller.evaluate((e) => {
      e.scrollTop = 350;
    });
    const row = board.getByRole("button", {
      name: "0015 연습 학생 15",
      exact: true,
    });
    await row.scrollIntoViewIfNeeded();
    const scrollBefore = await scroller.evaluate((e) => e.scrollTop);
    await row.click();
    await expect(
      board.getByRole("heading", { name: "0015 연습 학생 15", exact: true }),
    ).toBeVisible();
    await expect(
      board.getByText("아직 서버에 저장된 노트가 없습니다.", { exact: true }),
    ).toBeVisible();
    await board
      .getByRole("button", { name: "대시보드로 돌아가기", exact: true })
      .click();
    expect(await scroller.evaluate((e) => e.scrollTop)).toBe(scrollBefore);

    await student.goto("/a/" + link.token);
    await expect(student.locator(".ink")).toBeVisible();
    await student
      .getByRole("textbox", { name: "풀이 설명", exact: true })
      .fill("첫 문항의 풀이 초안");
    await expect(
      student.getByText("서버 저장 완료", { exact: true }),
    ).toBeVisible();
    await board
      .getByLabel("진행 상태", { exact: true })
      .selectOption("작성 중");
    await board.getByLabel("학생 찾기", { exact: true }).fill("0001");
    await expect(board.locator("tbody tr")).toHaveCount(1);
    await board
      .getByRole("button", {
        name: "0001 연습 학생 1 문항 1 · 작성 중",
        exact: true,
      })
      .click();
    const work = board.getByRole("region", { name: "학생 풀이 화면" });
    await expect(work).toContainText("첫 문항의 풀이 초안");
    await expect(work.getByRole("textbox")).toHaveCount(0);
    await work.getByRole("button", { name: "문항 2", exact: true }).click();
    await expect(
      work.getByText("아직 서버에 저장된 노트가 없습니다.", { exact: true }),
    ).toBeVisible();
    await work
      .getByRole("button", { name: "대시보드로 돌아가기", exact: true })
      .click();
    await expect(board.getByLabel("진행 상태", { exact: true })).toHaveValue(
      "작성 중",
    );
    await expect(board.getByLabel("학생 찾기", { exact: true })).toHaveValue(
      "0001",
    );
    await board.getByLabel("진행 상태", { exact: true }).selectOption("전체");
    await board.getByLabel("학생 찾기", { exact: true }).fill("");

    await student
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await expect(
      student.getByRole("button", { name: /1회차 원본/ }),
    ).toBeVisible();
    await expect(
      board.getByRole("button", {
        name: "0001 연습 학생 1 문항 1 · 제출",
        exact: true,
      }),
    ).toBeVisible();
    await board
      .getByRole("button", { name: "문항별 오답 분석", exact: true })
      .click();
    const analysis = board.getByRole("region", {
      name: "문항별 오답 분석",
      exact: true,
    });
    await expect(
      analysis.getByRole("button", {
        name: "문항 1 분석 · 채점 결과 없음",
        exact: true,
      }),
    ).toBeVisible();
    await analysis
      .getByRole("button", { name: "채점 대기 1명", exact: true })
      .click();
    await analysis
      .getByRole("button", { name: "0001 연습 학생 1 채점 대기", exact: true })
      .click();
    await work
      .getByRole("button", { name: "제출한 답안 검토", exact: true })
      .click();
    await expect(board.getByAltText("제출 풀이")).toBeVisible();
    await board.locator('input[type="number"]').fill("0");
    await board.getByLabel("교사 확인 오개념").fill("부호 오류");
    await board.getByLabel("확정 사유").fill("원본 풀이 확인");
    await board.getByRole("button", { name: "평가 확정", exact: true }).click();
    await expect(
      board.getByText("선택한 회차의 평가를 확정했습니다.", { exact: true }),
    ).toBeVisible();
    await board
      .getByRole("button", { name: "학생 풀이로 돌아가기", exact: true })
      .click();
    await expect(work).toContainText("확정 점수 0 / 10점");
    await work
      .getByRole("button", { name: "대시보드로 돌아가기", exact: true })
      .click();
    await expect(
      board.getByRole("button", { name: "문항별 오답 분석", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      analysis.getByRole("button", { name: "채점 대기 0명", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await analysis
      .getByRole("button", { name: "오답 1명", exact: true })
      .click();
    await expect(
      analysis.getByRole("button", {
        name: "0001 연습 학생 1 오답",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      analysis.getByText("부호 오류", { exact: true }),
    ).toBeVisible();
    await expect(
      analysis.getByRole("button", {
        name: "문항 1 분석 · 정답률 0%",
        exact: true,
      }),
    ).toBeVisible();

    // A new ungraded attempt replaces the earlier graded one in the analysis.
    await student.getByRole("button", { name: /문항 1.*필수/ }).click();
    await student
      .getByRole("textbox", { name: "풀이 설명", exact: true })
      .fill("다시 제출한 풀이");
    await student
      .getByRole("button", { name: "제출하기", exact: true })
      .click();
    await expect(
      student.getByRole("button", { name: /2회차 원본/ }),
    ).toBeVisible();
    await expect(
      analysis.getByRole("button", {
        name: "문항 1 분석 · 채점 결과 없음",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      analysis.getByRole("button", { name: "오답 0명", exact: true }),
    ).toBeVisible();
    const detail = await command("detail", { task: link.task });
    const latest = detail.subs.find((s) => s.attempt === 2);
    await command("review", {
      sub: latest.id,
      scores: { reason: 5 },
      feedback: {},
      reason: "최신 답안 확인",
      misconception: "설명 누락",
    });
    await expect(
      analysis.getByRole("button", { name: "부분정답 1명", exact: true }),
    ).toBeVisible();
    await analysis
      .getByRole("button", { name: "부분정답 1명", exact: true })
      .click();
    await expect(
      analysis.getByText("평균 5.0 / 10점 · 채점 1명", { exact: true }),
    ).toBeVisible();
    await expect(
      analysis.getByRole("img", { name: "평균 득점률 50%" }),
    ).toBeVisible();
    await analysis.screenshot({
      path: "/private/tmp/goodmath-question-analysis.png",
    });
    await board
      .getByRole("button", { name: "진행·제출 현황", exact: true })
      .click();
    await board.screenshot({
      path: "/private/tmp/goodmath-class-dashboard.png",
    });
    await board
      .getByRole("button", { name: "이름 가리기", exact: true })
      .click();
    await board.getByRole("button", { name: "학생 1", exact: true }).click();
    await expect(
      work.getByRole("heading", { name: "학생 1", exact: true }),
    ).toBeVisible();
    await expect(work.getByText("연습 학생 1", { exact: false })).toHaveCount(
      0,
    );
    await teacher.getByLabel("학급", { exact: true }).selectOption(otherClass);
    await expect(work).toHaveCount(0);
    await teacher.getByRole("button", { name: new RegExp(title) }).click();
    await teacher
      .getByRole("button", { name: "진행률 대시보드", exact: true })
      .click();
    await expect(board.locator("tbody tr")).toHaveCount(1);
    await expect(
      board.getByRole("button", { name: "0026 연습 학생 26", exact: true }),
    ).toBeVisible();
    await teacher.setViewportSize({ width: 390, height: 844 });
    expect(
      await teacher.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await board
      .getByRole("button", { name: "문항별 오답 분석", exact: true })
      .click();
    expect(
      await teacher.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
