import { defineConfig, loadEnv } from "vite";
export default defineConfig(async ({ command, mode }) => ({
  server: {
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
    command === "serve" && !loadEnv(mode, process.cwd()).VITE_SUPABASE_URL
      ? [(await import("./dev/plugin.js")).classroomDemo()]
      : [],
}));
