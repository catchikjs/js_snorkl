import { mockJob } from "./mock-worker.js";
import { database, rpc, student, teacher } from "./database.js";
import { dispatch } from "../supabase/functions/_shared/gateway.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
export function classroomDemo(configuredPassword) {
  const dir = process.env.GOODMATH_DEMO_DIR || ".goodmath";
  const teacherPassword = configuredPassword || randomBytes(12).toString("base64url");
  const teacherSessions = new Set();
  if (!configuredPassword)
    console.info(`[local-classroom] 교사 모드 비밀번호: ${teacherPassword}`);
  let dbPromise;
  return {
    name: "local-classroom",
    apply: "serve",
    configureServer(server) {
      const timer = setInterval(() => {
        if (dbPromise) dbPromise.then(mockJob).catch(() => {});
      }, 1000);
      server.httpServer?.once("close", () => clearInterval(timer));
      server.middlewares.use("/__classroom", async (req, res) => {
        let operation = "unknown";
        const send = (value, status = 200, headers = {}) => {
          res.writeHead(status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...headers,
          });
          res.end(JSON.stringify({ value }));
        };
        try {
          if (
            !["localhost", "127.0.0.1", "[::1]"].includes(
              new URL("http://" + req.headers.host).hostname,
            ) ||
            (req.headers.origin &&
              new URL(req.headers.origin).host !== req.headers.host)
          )
            return send(null, 403);
          if (req.method !== "POST") return send(null, 405);
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 32 * 1024 * 1024) throw Error();
            chunks.push(chunk);
          }
          const {
            op,
            p = {},
            persona,
          } = JSON.parse(Buffer.concat(chunks).toString());
          operation = op;
          const session = (req.headers.cookie || "")
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith("goodmath_teacher="))
            ?.slice("goodmath_teacher=".length);
          if (op === "teacher-login") {
            const supplied = Buffer.from(String(p.password || ""));
            const expected = Buffer.from(teacherPassword);
            if (
              supplied.length !== expected.length ||
              !timingSafeEqual(supplied, expected)
            )
              return send(null, 401);
            const token = randomBytes(32).toString("base64url");
            teacherSessions.add(token);
            return send(true, 200, {
              "Set-Cookie": `goodmath_teacher=${token}; HttpOnly; SameSite=Strict; Path=/__classroom`,
            });
          }
          if (op === "teacher-logout") {
            if (session) teacherSessions.delete(session);
            return send(true, 200, {
              "Set-Cookie":
                "goodmath_teacher=; HttpOnly; SameSite=Strict; Path=/__classroom; Max-Age=0",
            });
          }
          const u = teacherSessions.has(session) ? teacher : student(1);
          dbPromise ??= mkdir(dir, { recursive: true })
            .then(() => database(join(dir, "db")))
            .catch((error) => {
              dbPromise = undefined;
              throw error;
            });
          const db = await dbPromise;
          const command = (fn, op, p) => rpc(db, fn, [u, op, p]);
          if (op === "upload" || op === "download") {
            const { bucket, path } = p;
            if (
              !["math-sources", "math-originals"].includes(bucket) ||
              !/^[-0-9a-f]{36}\/[a-zA-Z0-9_.-]+$/.test(path)
            )
              throw Error();
            const allowed = await db.transaction(async (tx) => {
              await tx.query("select set_config('request.uid',$1,true)", [u]);
              return rpc(
                tx,
                bucket === "math-sources" ? "math_source_ok" : "math_asset_ok",
                bucket === "math-sources" ? [path] : [path, op === "upload"],
              );
            });
            if (!allowed) throw Error();
            const file = resolve(dir, "files", bucket, path);
            if (op === "download")
              return send((await readFile(file)).toString("base64"));
            await mkdir(resolve(file, ".."), { recursive: true });
            try {
              await writeFile(file, Buffer.from(p.base64, "base64"), {
                flag: "wx",
              });
            } catch (e) {
              if (e.code !== "EEXIST") throw e;
            }
            return send(true);
          }
          send(
            await dispatch(
              op,
              p,
              command,
              async (path) =>
                new Uint8Array(
                  await readFile(resolve(dir, "files/math-originals", path)),
                ).buffer,
            ),
          );
        } catch (e) {
          console.warn("[local-classroom]", operation, e.code || e.name, e.message);
          send(null, 400);
        }
      });
    },
  };
}
