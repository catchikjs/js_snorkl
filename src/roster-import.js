import Papa from "papaparse";
import {
  parseRosterClass,
  rosterClassPrefix,
} from "../supabase/functions/_shared/roster-class.js";

export const rosterLimit = 200;

export function matchesRosterClass(number, classroom) {
  const prefix = rosterClassPrefix(classroom);
  return (
    !prefix ||
    (typeof number === "string" &&
      /^[0-9]{5}$/.test(number.trim()) &&
      number.trim().startsWith(prefix))
  );
}

export function routeRosterRows(rows, classes) {
  return rows.map((row) => {
    const destination = parseRosterClass(row.class_name);
    if (
      !destination ||
      !/^[1-9][0-9]{4}$/.test(row.number) ||
      row.number.slice(0, 3) !== destination.prefix
    )
      throw Error(
        `${row.number}: 학번 앞 세 자리와 입력한 학급이 일치하지 않습니다.`,
      );
    const matches = classes.filter(
      (c) => parseRosterClass(c.name)?.name === destination.name,
    );
    if (matches.length !== 1 || !matchesRosterClass(row.number, matches[0]))
      throw Error(
        `${destination.name}을 담당 학급에서 찾을 수 없거나 학번 규칙이 다릅니다.`,
      );
    return { ...row, class_name: destination.name, class_id: matches[0].id };
  });
}

export function parseRosterRows(rows, { requirePassword = false } = {}) {
  const entries = rows
    .map((columns, i) => ({ columns, line: i + 1 }))
    .filter(({ columns }) => columns.some((cell) => String(cell ?? "").trim()));
  if (
    String(entries[0]?.columns[0] ?? "").trim() === "학번" &&
    String(entries[0]?.columns[1] ?? "").trim() === "이름"
  ) {
    if (
      String(entries[0].columns[2] ?? "").trim() !== "학급" ||
      String(entries[0].columns[3] ?? "").replace(/\s/g, "") !==
        "초기비밀번호" ||
      entries[0].columns.length !== 4
    )
      throw Error("학번·이름·학급·초기비밀번호 순서의 네 열을 사용하세요.");
    entries.shift();
  }
  if (!entries.length || entries.length > rosterLimit)
    throw Error(`학생 1~${rosterLimit}명을 입력하세요.`);
  const seen = new Set();
  return entries.map(({ columns, line }) => {
    if (columns.length !== 4)
      throw Error(`${line}행: 학번·이름·학급·초기비밀번호 네 열을 확인하세요.`);
    const [rawNumber, rawLabel, rawClass, password = ""] = columns.map((cell) =>
      String(cell ?? ""),
    );
    const number = rawNumber.trim(),
      label = rawLabel.trim();
    if (!number || !label || number.length > 100 || label.length > 100)
      throw Error(`${line}행: 학번과 이름을 확인하세요.`);
    const classroom = parseRosterClass(rawClass);
    if (!classroom)
      throw Error(
        `${line}행: 학급은 ‘1학년 1반’ 또는 ‘101’ 형식으로 입력하세요.`,
      );
    if (
      !/^[1-9][0-9]{4}$/.test(number) ||
      number.slice(0, 3) !== classroom.prefix
    )
      throw Error(
        `${line}행: 학번 앞 세 자리와 학급이 일치하지 않습니다 (${number} / ${classroom.name}).`,
      );
    if (
      (requirePassword || password.length > 0) &&
      (password.length < 6 || password.length > 200)
    )
      throw Error(`${line}행: 초기 비밀번호는 6~200자로 입력하세요.`);
    if (seen.has(number))
      throw Error(`${line}행: 같은 학번이 중복되어 있습니다.`);
    seen.add(number);
    return { number, label, class_name: classroom.name, password };
  });
}

export function parseRosterText(text, delimiter = ",", options = {}) {
  const result = Papa.parse(text.replace(/^\uFEFF/, ""), {
    delimiter,
    dynamicTyping: false,
    skipEmptyLines: "greedy",
  });
  if (result.errors.length)
    throw Error(
      "파일의 따옴표와 열 구분을 확인하세요. CSV 양식으로 다시 저장해 주세요.",
    );
  return parseRosterRows(result.data, options);
}

export function parseRosterPaste(text) {
  return parseRosterText(text, "\t", { requirePassword: true });
}

function cellText(cell, line) {
  if (cell.value == null) return "";
  if (typeof cell.value === "string") return cell.value;
  if (
    typeof cell.value === "number" &&
    Number.isSafeInteger(cell.value) &&
    cell.value >= 0
  ) {
    // Keep leading zeroes when the Excel cell explicitly uses a 00000 format.
    return /^0+$/.test(cell.numFmt || "")
      ? String(cell.value).padStart(cell.numFmt.length, "0")
      : String(cell.value);
  }
  if (typeof cell.value === "object" && cell.value.richText)
    return cell.value.richText.map((part) => part.text).join("");
  throw Error(
    `${line}행: 수식·날짜 대신 학번, 이름, 학급, 비밀번호를 텍스트로 입력하세요.`,
  );
}

export async function parseRosterFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (!["xlsx", "csv", "tsv"].includes(extension))
    throw Error(
      "엑셀(.xlsx), CSV, TSV 파일을 선택하세요. .xls 파일은 .xlsx로 저장해 주세요.",
    );
  if (file.size > 5 * 1024 * 1024)
    throw Error("명부 파일은 5MB 이하로 올려 주세요.");
  const bytes = await file.arrayBuffer();
  if (extension !== "xlsx") {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("euc-kr").decode(bytes);
    }
    return parseRosterText(text, extension === "tsv" ? "\t" : ",");
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    throw Error(
      "엑셀 파일을 읽지 못했습니다. 암호를 해제하고 .xlsx로 다시 저장해 주세요.",
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw Error("첫 번째 시트에 학생 명부를 입력하세요.");
  const rows = [];
  sheet.eachRow((row, line) => {
    if (rows.length > rosterLimit)
      throw Error(`학생은 한 번에 ${rosterLimit}명까지 불러올 수 있습니다.`);
    const columns = [];
    row.eachCell((cell, col) => {
      const value = cellText(cell, line);
      if (col > 4 && value.trim())
        throw Error(
          `${line}행: 학번·이름·학급·초기비밀번호 네 열만 사용하세요.`,
        );
      if (col <= 4) columns[col - 1] = value;
    });
    rows.push(Array.from({ length: 4 }, (_, i) => columns[i] ?? ""));
  });
  return parseRosterRows(rows);
}

export function mergeRosterRows(current, incoming) {
  const kept = current.filter(
    (row) => row.done || row.number || row.label || row.password,
  );
  if (kept.filter((row) => !row.done).length + incoming.length > rosterLimit)
    throw Error(`한 번에 ${rosterLimit}명까지 등록·배정할 수 있습니다.`);
  const seen = new Set(kept.map((row) => row.number.trim()));
  for (const row of incoming) {
    if (seen.has(row.number))
      throw Error(
        "입력표에 이미 있는 학번이 포함돼 있습니다. 중복 행을 삭제하고 다시 불러오세요.",
      );
    seen.add(row.number);
  }
  return [
    ...kept,
    ...incoming.map((row) => ({
      id: crypto.randomUUID(),
      ...row,
      status: "",
      done: false,
    })),
  ];
}

export async function rosterTemplate() {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("학생 명부");
  sheet.columns = [
    { header: "학번", key: "number", width: 20 },
    { header: "이름", key: "label", width: 20 },
    { header: "학급", key: "class_name", width: 22 },
    { header: "초기비밀번호", key: "password", width: 26 },
  ];
  sheet.columns.forEach((col) => {
    col.numFmt = "@";
  });
  sheet.getRow(1).font = { name: "Arial", bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const guide = workbook.addWorksheet("작성 안내");
  guide.getColumn(1).width = 85;
  [
    "첫 번째 ‘학생 명부’ 시트에 학번·이름·학급·초기비밀번호 네 열을 입력하세요.",
    "예시: 10101 / 김학생 / 1학년 1반 / 학생별로 정한 6~200자 비밀번호",
    "학급은 ‘1학년 1반’, ‘101’, ‘1-1’ 형식을 지원합니다. 학번 앞 세 자리와 일치해야 합니다.",
    "기존 학생은 학번·이름을 정확히 쓰고 비밀번호를 비워 두세요. 기존 비밀번호는 유지됩니다.",
    "학번은 텍스트 형식을 유지하세요. 최대 200명, 파일 크기 5MB입니다.",
    "전체 학년 명부를 한 번에 올릴 수 있습니다. 파일의 학급에 따라 각 반에 나눠 등록·배정합니다.",
    "기존 학생이 잘못된 반에 등록되어 있으면 소속을 바로잡습니다. 계정·비밀번호·기존 제출은 보존합니다.",
  ].forEach((text) => {
    guide.addRow([text]).font = { name: "Arial", size: 11 };
  });
  return workbook.xlsx.writeBuffer();
}
