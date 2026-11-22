import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  parseRosterFile,
  parseRosterText,
  mergeRosterRows,
  rosterTemplate,
  routeRosterRows,
  matchesRosterClass,
} from "../src/roster-import.js";

test("a 137-student grade routes by each row's explicit class, with number validation", () => {
  const counts = [18, 20, 20, 20, 19, 20, 20];
  const classes = counts.map((_, i) => ({
    id: String(i),
    name: `1학년 ${i + 1}반`,
    number_prefix: `10${i + 1}`,
  }));
  const rows = parseRosterText(
    counts
      .flatMap((n, i) =>
        Array.from(
          { length: n },
          (_, j) =>
            `10${i + 1}${String(j + 1).padStart(2, "0")},가상 학생,1학년 ${i + 1}반,abcdef`,
        ),
      )
      .join("\n"),
  );
  const routed = routeRosterRows(rows, classes);
  assert.equal(routed.length, 137);
  assert.deepEqual(
    classes.map((c) => routed.filter((r) => r.class_id === c.id).length),
    counts,
  );
  assert.throws(
    () => routeRosterRows([{ ...rows[0], class_name: "1학년 2반" }], classes),
    /학번 앞 세 자리/,
  );
  assert.throws(() => routeRosterRows(rows, classes.slice(0, 1)), /담당 학급/);
  assert.throws(
    () => routeRosterRows(rows, [...classes, classes[0]]),
    /담당 학급/,
  );
  assert.equal(
    matchesRosterClass("10201", {
      school: "경복비즈니스고등학교",
      year: 2026,
      name: "1학년 1반",
    }),
    false,
  );
  assert.equal(
    matchesRosterClass("0001", {
      school: "가상학교",
      year: 2026,
      name: "1학년 1반",
    }),
    true,
  );
});

test("four-column CSV and TSV preserve names and password whitespace, normalize class aliases and reject mismatches", async () => {
  const csv =
    '\uFEFF학번,이름,학급,초기 비밀번호\r\n10101,"김,학생",101," ab""cd,ef "\r\n10201,이학생,1학년 2반,\r\n';
  assert.deepEqual(await parseRosterFile(new File([csv], "명부.csv")), [
    {
      number: "10101",
      label: "김,학생",
      class_name: "1학년 1반",
      password: ' ab"cd,ef ',
    },
    { number: "10201", label: "이학생", class_name: "1학년 2반", password: "" },
  ]);
  assert.deepEqual(
    await parseRosterFile(
      new File(
        ["학번\t이름\t학급\t초기비밀번호\n10101\t가상 학생\t1-1\t\n"],
        "기존.tsv",
      ),
    ),
    [
      {
        number: "10101",
        label: "가상 학생",
        class_name: "1학년 1반",
        password: "",
      },
    ],
  );
  assert.throws(() => parseRosterText('10101,"김학생,101,abcdef'), /따옴표/);
  assert.throws(
    () => parseRosterText("10101,가,101,abcdef\n10101,나,101,abcdef"),
    /중복/,
  );
  assert.throws(() => parseRosterText("10101,가,101,12345"), /6~200/);
  assert.throws(() => parseRosterText("10101,가,abcdef"), /네 열/);
  assert.throws(
    () => parseRosterText("학번,이름,초기비밀번호\n10101,가,abcdef"),
    /네 열/,
  );
  assert.throws(
    () => parseRosterText("10201,가,101,abcdef"),
    /학번 앞 세 자리/,
  );
  assert.throws(
    () => parseRosterText("00101,가,101,abcdef"),
    /학번 앞 세 자리/,
  );
});

test("Excel template has four text columns, accepts numeric class codes and rejects formulas", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await rosterTemplate());
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, "학생 명부");
  assert.deepEqual(sheet.getRow(1).values.slice(1), [
    "학번",
    "이름",
    "학급",
    "초기비밀번호",
  ]);
  assert.equal(sheet.getColumn(1).numFmt, "@");
  sheet.addRow(["10101", "김학생", "1학년 1반", " abcdef "]);
  sheet.addRow([10201, "이학생", 102]);
  const file = () =>
    workbook.xlsx.writeBuffer().then((bytes) => new File([bytes], "명부.xlsx"));
  assert.deepEqual(await parseRosterFile(await file()), [
    {
      number: "10101",
      label: "김학생",
      class_name: "1학년 1반",
      password: " abcdef ",
    },
    { number: "10201", label: "이학생", class_name: "1학년 2반", password: "" },
  ]);
  sheet.getCell("D2").value = { formula: '"abcdef"', result: "abcdef" };
  await assert.rejects(parseRosterFile(await file()), /수식/);
});

test("invalid files, oversized rosters and duplicates leave the existing preview intact", async () => {
  await assert.rejects(parseRosterFile(new File(["bad"], "명부.xls")), /xlsx/);
  await assert.rejects(
    parseRosterFile(new File(["bad"], "명부.xlsx")),
    /읽지 못/,
  );
  await assert.rejects(
    parseRosterFile({ name: "명부.csv", size: 6 * 1024 * 1024 }),
    /5MB/,
  );
  assert.throws(
    () =>
      parseRosterText(
        Array.from({ length: 201 }, (_, i) => `${i},학생,101,abcdef`).join(
          "\n",
        ),
      ),
    /200/,
  );
  const original = [
    {
      id: "keep",
      number: "10101",
      label: "기존",
      class_name: "1학년 1반",
      password: "",
      done: true,
    },
  ];
  assert.throws(
    () =>
      mergeRosterRows(original, [
        {
          number: "10101",
          label: "중복",
          class_name: "1학년 1반",
          password: "",
        },
      ]),
    /중복/,
  );
  const next = mergeRosterRows(original, [
    {
      number: "10201",
      label: "신규",
      class_name: "1학년 2반",
      password: "abcdef",
    },
  ]);
  assert.equal(original.length, 1);
  assert.equal(next.length, 2);
  assert.equal(next[1].done, false);
  assert.ok(next[1].id);
});
