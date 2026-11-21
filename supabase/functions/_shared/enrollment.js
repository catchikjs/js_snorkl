export class EnrollmentError extends Error {}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function enrollStudent(db, teacher, input, school, year) {
  const { id, class_id, password } = input;
  const number = typeof input.number === "string" ? input.number.trim() : "";
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!uuid.test(id || "") || !uuid.test(class_id || "") || !number || !label ||
      number.length > 100 || label.length > 100 || typeof password !== "string" ||
      password.length < 6 || password.length > 200) {
    throw new EnrollmentError("학번·이름과 초기 비밀번호(6~200자)를 확인하세요.");
  }
  const p = { id, class_id, number, label };
  async function command(op) {
    const { data, error } = await db.rpc("math_teacher_enroll", { u: teacher, op, p });
    if (error) {
      if (error.message?.includes("enroll_duplicate"))
        throw new EnrollmentError("이 학번은 이미 등록되어 있습니다. 기존 계정은 변경하지 않았습니다.");
      if (error.message?.includes("enroll_denied"))
        throw new EnrollmentError("담당 학급에만 학생을 등록할 수 있습니다.");
      throw new EnrollmentError("명부 연결을 완료하지 못했습니다. 같은 행에서 다시 등록해 주세요.");
    }
    return data;
  }
  const checked = await command("check");
  if (checked.school !== school || checked.year !== year)
    throw new EnrollmentError("현재 로그인 학교·학년도와 일치하는 학급을 선택하세요.");
  if (checked.registered) return { registered: true, already_registered: true };

  const binding = { teacher, class_id, number, label };
  const created = await db.auth.admin.createUser({
    id, email: id + "@classroom.invalid", password, email_confirm: true,
    app_metadata: { goodmath_enrollment: binding },
  });
  if (created.error) {
    // A response may have been lost after Auth created this exact request's user.
    const existing = await db.auth.admin.getUserById(id);
    const previous = existing.data?.user?.app_metadata?.goodmath_enrollment;
    if (existing.error || !previous ||
        Object.entries(binding).some(([key, value]) => previous[key] !== value)) {
      throw new EnrollmentError("계정을 생성하지 못했습니다. 비밀번호는 6자 이상인지 확인하고 다시 시도하세요.");
    }
  }
  try {
    await command("commit");
  } catch (error) {
    // Recheck before cleanup: a timed-out commit may actually have succeeded.
    let status;
    try { status = await command("check"); } catch (checkError) {
      if (checkError instanceof EnrollmentError && checkError.message.includes("이미 등록"))
        status = { registered: false };
    }
    if (status?.registered) return { registered: true, already_registered: true };
    if (!created.error && status?.registered === false)
      await db.auth.admin.deleteUser(id);
    throw error;
  }
  return { registered: true, already_registered: false };
}
