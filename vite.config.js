import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const e = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: { proxy: { "/api": `http://127.0.0.1:${e.PORT || 3000}` } },
  };
});
