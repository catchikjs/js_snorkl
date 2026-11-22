import { test, expect } from "@playwright/test";

test("distribution previews only selected classes and blocks a mixed-class roster", async ({page}) => {
  const sent = [];
  let mixed = true;
  const first = "20000000-0000-4000-8000-000000000001";
  await page.route("**/__classroom", async (route) => {
    const {op,p} = route.request().postDataJSON();
    if (op === "roster") return route.fulfill({json:{value:[
      {number:p.class_id===first && mixed ? "10201" : p.class_id===first ? "10101" : "10201",label:"가상 학생"}
    ]}});
    if (op === "distribute") sent.push(p.class_id);
    if (op !== "home") return route.continue();
    const response = await route.fetch(), body = await response.json();
    body.value.classes.forEach(c => c.number_prefix=c.id===first ? "101" : "102");
    return route.fulfill({response,json:body});
  });
  await page.goto("/");
  await page.getByRole("button",{name:"교사 모드로 전환"}).click();
  const dialog = page.getByRole("dialog",{name:"교사 모드 비밀번호"});
  await dialog.getByLabel("비밀번호",{exact:true}).fill("browser-test-teacher");
  await dialog.getByRole("button",{name:"교사 모드로 전환"}).click();
  await page.getByRole("button",{name:"역함수의 식 구하기 확정"}).click();
  await page.getByRole("main").getByRole("button",{name:"학급별 배포",exact:true}).click();
  await expect(page.getByText("배포 대상: 1학년 1반 1명",{exact:true})).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("다른 반 학번");
  await expect(page.getByRole("button",{name:"선택 학급에 배포"})).toBeDisabled();
  expect(sent).toEqual([]);
  mixed=false;
  await page.getByRole("checkbox",{name:"1학년 1반",exact:true}).uncheck();
  await page.getByRole("checkbox",{name:"1학년 1반",exact:true}).check();
  await expect(page.getByRole("button",{name:"선택 학급에 배포"})).toBeEnabled();
  await expect(page.getByRole("checkbox",{name:"1학년 2반",exact:true})).not.toBeChecked();
  await page.getByRole("button",{name:"선택 학급에 배포"}).click();
  await expect(page.getByText("배포했습니다.",{exact:true}).first()).toBeVisible();
  expect(sent).toEqual([first]);
});

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
