export function parseRosterClass(value) {
  const text = String(value ?? "").replace(/\s/g, "");
  const match =
    text.match(/^([1-9])학년([0-9]{1,2})반$/) ||
    text.match(/^([1-9])[-/]([0-9]{1,2})$/) ||
    text.match(/^([1-9])([0-9]{2})$/);
  if (!match || Number(match[2]) < 1) return null;
  return {
    name: `${match[1]}학년 ${Number(match[2])}반`,
    prefix: match[1] + match[2].padStart(2, "0"),
  };
}

export function rosterClassPrefix(classroom) {
  if (classroom.number_prefix) return classroom.number_prefix;
  // The confirmed school rule also guards older DB responses before migration.
  if (classroom.school === "경복비즈니스고등학교" && classroom.year === 2026)
    return parseRosterClass(classroom.name)?.prefix;
  return null;
}
