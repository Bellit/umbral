import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// public/privado (fotos personales) solo se sirve en local: no debe llegar a dist.
function withoutPrivateFiles(): Plugin {
  return {
    name: "umbral-without-private-files",
    apply: "build",
    closeBundle() { rmSync(resolve(__dirname, "dist/privado"), { recursive: true, force: true }); },
  };
}

// base "./" permite publicar la ficha en cualquier carpeta o alojamiento estático.
export default defineConfig({
  base: "./",
  plugins: [react(), withoutPrivateFiles()],
});
