import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  parseRosterFile,
  parseRosterText,
  mergeRosterRows,
  rosterTemplate,
} from "../src/roster-import.js";

test("CSV and TSV keep leading zeros, quoted commas, Korean and password whitespace", async () => {
  const csv =
    '\uFEFF학번,이름,초기 비밀번호\r\n00101,"김,학생"," ab""cd,ef "\r\n00102,이학생,\r\n';
  assert.deepEqual(await parseRosterFile(new File([csv], "명부.csv")), [
    { number: "00101", label: "김,학생", password: ' ab"cd,ef ' },
    { number: "00102", label: "이학생", password: "" },
  ]);
  assert.deepEqual(
    await parseRosterFile(
      new File(["학번\t이름\n0001\t연습 학생 1\n"], "기존.tsv"),
    ),
    [{ number: "0001", label: "연습 학생 1", password: "" }],
  );
  assert.throws(() => parseRosterText('001,"김학생,abcdef'), /따옴표/);
  assert.throws(() => parseRosterText("1,가,abcdef\n1,나,abcdef"), /중복/);
  assert.throws(() => parseRosterText("1,가,12345"), /6~200/);
  assert.throws(() => parseRosterText("1,가,abcdef,추가"), /세 열/);
});

test("Excel template reads text IDs and numeric IDs with explicit zero padding, but rejects formulas", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await rosterTemplate());
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, "학생 명부");
  assert.equal(sheet.getColumn(1).numFmt, "@");
  sheet.addRow(["00101", "김학생", " abcdef "]);
  sheet.addRow([102, "이학생"]);
  sheet.getCell("A3").numFmt = "00000";
  const file = () =>
    workbook.xlsx.writeBuffer().then((bytes) => new File([bytes], "명부.xlsx"));
  assert.deepEqual(await parseRosterFile(await file()), [
    { number: "00101", label: "김학생", password: " abcdef " },
    { number: "00102", label: "이학생", password: "" },
  ]);
  sheet.getCell("C2").value = { formula: '"abcdef"', result: "abcdef" };
  await assert.rejects(parseRosterFile(await file()), /수식/);
});

test("invalid files, oversized rosters and duplicates against the current preview leave input intact", async () => {
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
        Array.from({ length: 201 }, (_, i) => `${i},학생,abcdef`).join("\n"),
      ),
    /200/,
  );
  const original = [
    { id: "keep", number: "00101", label: "기존", password: "", done: true },
  ];
  assert.throws(
    () =>
      mergeRosterRows(original, [
        { number: "00101", label: "중복", password: "" },
      ]),
    /중복/,
  );
  const next = mergeRosterRows(original, [
    { number: "00102", label: "신규", password: "abcdef" },
  ]);
  assert.equal(original.length, 1);
  assert.equal(next.length, 2);
  assert.equal(next[1].done, false);
  assert.ok(next[1].id);
});
