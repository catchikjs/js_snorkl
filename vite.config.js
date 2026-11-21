import { defineConfig, loadEnv } from "vite";
export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: {
      strictPort: true,
      fs: {
        deny: [
          ".env",
          ".env.*",
          "**/.git/**",
          "**/.goodmath/**",
          "**/supabase/**/secrets.env",
        ],
      },
    },
    plugins:
      command === "serve" && !env.VITE_SUPABASE_URL
        ? [
            (
              await import("./dev/plugin.js")
            ).classroomDemo(env.GOODMATH_DEMO_TEACHER_PASSWORD),
          ]
        : [],
  };
});
