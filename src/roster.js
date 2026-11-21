export function parseRosterPaste(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || lines.length > 201) throw Error("학생 1~200명의 세 열을 붙여넣어 주세요.");
  const cells = lines.map((line) => line.split("\t"));
  if (cells[0][0]?.trim() === "학번" && cells[0][1]?.trim() === "이름") cells.shift();
  if (!cells.length || cells.length > 200) throw Error("학생 1~200명을 입력하세요.");
  const seen = new Set();
  return cells.map((columns, index) => {
    if (columns.length !== 3) throw Error(`${index + 1}행: 학번·이름·초기 비밀번호 세 열을 복사하세요.`);
    const [rawNumber, rawLabel, password] = columns;
    const number = rawNumber.trim(), label = rawLabel.trim();
    if (!number || !label || number.length > 100 || label.length > 100)
      throw Error(`${index + 1}행: 학번과 이름을 확인하세요.`);
    if (password.length < 6 || password.length > 200)
      throw Error(`${index + 1}행: 초기 비밀번호는 6~200자로 입력하세요.`);
    if (seen.has(number)) throw Error(`${index + 1}행: 같은 학번이 중복되어 있습니다.`);
    seen.add(number);
    return { number, label, password };
  });
}
