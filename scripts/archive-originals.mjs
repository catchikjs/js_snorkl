// Administrator terminal only; dry run unless --apply is explicitly provided.
import { createClient } from "@supabase/supabase-js";
import { archiveOriginals } from "../supabase/functions/_shared/archive-originals.js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
  throw Error(
    "관리자 환경에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 설정하세요.",
  );
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply"))
  throw Error("사용법: node scripts/archive-originals.mjs [--apply]");
const apply = args.includes("--apply");
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function command(op, p = {}) {
  const { data, error } = await db.rpc("math_archive_originals", { op, p });
  if (error) throw error;
  return data;
}
let after,
  submissions = 0,
  files = 0,
  bytes = 0;
for (;;) {
  const candidates = await command("list", after ? { after } : {});
  if (!candidates.length) break;
  for (const candidate of candidates) {
    if (apply)
      await archiveOriginals(
        candidate,
        db.storage.from("math-originals"),
        (p) => command("commit", p),
      );
    submissions++;
    files += candidate.manifest.files.length;
    bytes += candidate.manifest.files.reduce((sum, f) => sum + f.bytes, 0);
    after = candidate.id;
  }
}
console.log(
  JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    submissions,
    files,
    bytes,
    originals_deleted: 0,
  }),
);
