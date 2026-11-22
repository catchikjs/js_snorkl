import { EnrollmentError } from "./enrollment.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resetStudentPassword(db, teacher, input, school, year) {
  const { class_id, uid, password } = input;
  if (!uuid.test(class_id || "") || !uuid.test(uid || ""))
    throw new EnrollmentError("학급과 학생을 다시 선택하세요.");
  if (
    typeof password !== "string" ||
    password.length < 6 ||
    password.length > 200 ||
    !password.trim()
  )
    throw new EnrollmentError("새 비밀번호를 6~200자로 입력하세요.");

  const { data: target, error } = await db.rpc("math_password_reset_target", {
    u: teacher,
    p: { class_id, uid },
  });
  if (error) {
    if (error.message?.includes("reset_activation_required"))
      throw new EnrollmentError(
        "아직 활성화되지 않은 계정입니다. 학생 활성화 후 비밀번호를 초기화하세요.",
      );
    if (error.message?.includes("reset_denied"))
      throw new EnrollmentError(
        "현재 담당 학급에 등록된 학생만 비밀번호를 초기화할 수 있습니다. 명부를 새로고침하세요.",
      );
    throw new EnrollmentError(
      "학생 계정을 확인하지 못했습니다. 잠시 후 다시 시도하세요.",
    );
  }
  if (
    !target ||
    target.uid !== uid ||
    target.school !== school ||
    target.year !== year
  )
    throw new EnrollmentError("학급과 학생 로그인 설정이 일치하지 않습니다.");

  const account = await db.auth.admin.getUserById(target.uid);
  if (
    account.error ||
    account.data?.user?.id !== target.uid ||
    account.data?.user?.email !== target.alias
  )
    throw new EnrollmentError("등록된 학생 계정 정보를 확인하지 못했습니다.");

  // Change only the selected student's password, preserving identity and work.
  const result = await db.auth.admin.updateUserById(target.uid, { password });
  if (result.error || result.data?.user?.id !== target.uid)
    throw new EnrollmentError(
      "비밀번호 초기화 결과를 확인하지 못했습니다. 비밀번호 조건과 연결을 확인한 뒤 같은 비밀번호로 다시 시도하세요.",
    );
  return { reset: true, uid: target.uid };
}
