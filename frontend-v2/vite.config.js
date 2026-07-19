import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    base: "/SAW/",
    build: {
        outDir: "dist",
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("@supabase"))
                        return "supabase";
                    if (id.includes("@tanstack"))
                        return "query";
                    if (id.includes("lucide-react"))
                        return "icons";
                    if (id.includes("react") || id.includes("react-router"))
                        return "react";
                },
            },
        },
    },
});
