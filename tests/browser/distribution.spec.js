import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import QRCode from "qrcode";

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


for (const scenario of ["second-only", "partial-retry"]) {
  test(`distribution verifies the selected class and exposes the result beside the button: ${scenario}`, async ({page}) => {
    const first = "20000000-0000-4000-8000-000000000001";
    const second = "20000000-0000-4000-8000-000000000002";
    const command = async (op, p = {}) => {
      const res = await page.request.post("/__classroom", {data:{op,p}});
      expect(res.ok()).toBe(true);
      return (await res.json()).value;
    };
    await command("teacher-login",{password:"browser-test-teacher"});
    const [source] = await command("library");
    const {working} = await command("book",{book:source.id});
    const title = `선택 학급 검증 ${scenario}`;
    working.title = title;
    const book = await command("new",{class_id:first,title,working});
    await command("approve",{book,revision:1,working});
    const previous = await command("distribute",{book,class_id:first});
    const sent = [];
    let failSecond = scenario === "partial-retry";
    await page.route("**/__classroom", async route => {
      const {op,p} = route.request().postDataJSON();
      if (op === "distribute") {
        sent.push(p.class_id);
        if (p.class_id === second && failSecond) {
          failSecond = false;
          return route.fulfill({status:503,json:{value:null}});
        }
      }
      return route.continue();
    });
    await page.goto("/");
    await page.getByRole("button",{name:title+" 확정",exact:true}).click();
    await page.getByRole("main").getByRole("button",{name:"학급별 배포",exact:true}).click();
    if (scenario === "second-only") {
      await page.getByRole("checkbox",{name:"1학년 1반",exact:true}).uncheck();
      await expect(page.getByRole("button",{name:"선택 학급에 배포",exact:true})).toBeDisabled();
      await expect(page.getByText("배포할 학급을 선택하세요.",{exact:true})).toBeVisible();
    }
    await page.getByRole("checkbox",{name:"1학년 2반",exact:true}).check();
    if (scenario !== "partial-retry") {
      await expect(page.getByRole("button",{name:"1학년 1반 QR 보기",exact:true})).toHaveCount(0);
      await expect(page.getByText(/선택한 학급에 배포된 평가가 없습니다/)).toBeVisible();
    }
    await page.getByRole("button",{name:"선택 학급에 배포",exact:true}).click();
    if (scenario === "partial-retry") {
      const failedDialog = page.getByRole("alertdialog",{name:"일부 학급 배포 실패",exact:true});
      await expect(failedDialog).toContainText("1학년 1반 25명에게 배포되었습니다.");
      await expect(failedDialog).toContainText("1학년 2반 배포 실패:");
      await failedDialog.getByRole("button",{name:"확인",exact:true}).click();
      await expect(page.getByRole("checkbox",{name:"1학년 1반",exact:true})).not.toBeChecked();
      await expect(page.getByRole("checkbox",{name:"1학년 2반",exact:true})).toBeChecked();
      await expect(page.getByRole("group",{name:"1학년 2반 배포 버전 1",exact:true})).toHaveCount(0);
      await page.getByRole("button",{name:"선택 학급에 배포",exact:true}).click();
    }
    const completed = page.getByRole("alertdialog",{name:"배포 완료",exact:true});
    await expect(completed).toContainText("1학년 2반 1명에게 배포되었습니다.");
    await expect(completed.getByRole("button",{name:"1학년 1반 QR 보기",exact:true})).toHaveCount(0);
    if (scenario !== "partial-retry") {
      await completed.getByRole("button",{name:"1학년 2반 QR 보기",exact:true}).click();
      const qr = page.getByRole("dialog",{name:"1학년 2반 배포 QR",exact:true});
      await expect(qr.getByAltText("1학년 2반 배포 링크 QR")).toBeVisible();
      const latest = await command("book",{book});
      const secondLink = latest.links.find(l=>l.class_id===second);
      const expectedHref = new URL("/a/"+secondLink.token,page.url()).href;
      await expect(qr.getByRole("link",{name:"1학년 2반 배포 링크 열기",exact:true})).toHaveAttribute("href",expectedHref);
      const downloaded = page.waitForEvent("download");
      await qr.getByRole("button",{name:"SVG 저장",exact:true}).click();
      const file = await downloaded;
      expect(file.suggestedFilename()).toBe("1학년 2반-배포-QR.svg");
      expect(await readFile(await file.path(),"utf8")).toBe(await QRCode.toString(expectedHref,{type:"svg"}));
      await qr.getByRole("button",{name:"닫기",exact:true}).click();
      await expect(page.getByRole("group",{name:"1학년 1반 배포 버전 1",exact:true})).toHaveCount(0);
      await page.getByRole("button",{name:"전체 학급 배포 내역 보기",exact:true}).click();
      await page.getByRole("group",{name:"1학년 1반 배포 버전 1",exact:true}).getByRole("button",{name:"1학년 1반 QR 보기",exact:true}).click();
      const firstQr = page.getByRole("dialog",{name:"1학년 1반 배포 QR",exact:true});
      await expect(firstQr.getByRole("link",{name:"1학년 1반 배포 링크 열기",exact:true})).toHaveAttribute("href",new URL("/a/"+previous.token,page.url()).href);
      await firstQr.getByRole("button",{name:"닫기",exact:true}).click();
    } else {
      await completed.getByRole("button",{name:"확인",exact:true}).click();
    }
    await expect(page.getByText("1학년 2반 1명 배포 완료",{exact:true})).toBeVisible();
    await expect(page.getByRole("group",{name:"1학년 2반 배포 버전 1",exact:true})).toContainText("배정 1명");
    await expect(page.getByRole("heading",{name:"학급별 배포 내역",exact:true})).toBeVisible();
    expect(sent).toEqual(scenario === "partial-retry" ? [first,second,second] : [second]);
    const saved = await command("book",{book});
    expect(saved.class_id).toBe(first);
    expect(saved.links).toHaveLength(2);
    expect(saved.links.find(l=>l.class_id===first).task).toBe(previous.task);
    expect(saved.links.find(l=>l.class_id===first).people).toBe(25);
    expect(saved.links.find(l=>l.class_id===second).people).toBe(1);
  });
}
