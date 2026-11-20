// Administrator terminal only. Reuse an existing Auth UUID to reissue an activation code.
import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
const [class_id, number, label, uidArg] = process.argv.slice(2);
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CODE_PEPPER } = process.env;
if (
  !class_id ||
  !number ||
  !label ||
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !CODE_PEPPER
)
  throw Error("관리자 환경과 학급 UUID, 학번, 표시 이름을 입력하세요.");
const code = randomBytes(18).toString("base64url"),
  hash = createHash("sha256")
    .update(CODE_PEPPER + code)
    .digest("hex");
const path = process.env.ACTIVATION_OUTPUT;
if (!path) throw Error("ACTIVATION_OUTPUT에 비공개 출력 파일을 지정하세요.");
await writeFile(path, code + "\n", { mode: 0o600, flag: "wx" });
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let user;
if (uidArg) {
  const r = await db.auth.admin.getUserById(uidArg);
  if (r.error) throw r.error;
  user = r.data.user;
} else {
  const r = await db.auth.admin.createUser({
    email: crypto.randomUUID() + "@classroom.invalid",
    password: randomBytes(32).toString("base64url"),
    email_confirm: true,
  });
  if (r.error) throw r.error;
  user = r.data.user;
}
const { error } = await db.rpc("math_provision", {
  p: { class_id, number, label, uid: user.id, alias: user.email, hash },
});
if (error) {
  console.error(
    "명부 연결 실패. Auth UUID로 설정을 확인한 뒤 같은 계정을 재사용하세요.",
    user.id,
  );
  process.exitCode = 1;
} else {
  console.log(
    "활성화 코드를 지정한 파일에 저장했습니다. 유효 기간은 24시간입니다.",
  );
}
