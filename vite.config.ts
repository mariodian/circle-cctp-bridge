import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Vite serves imported CSS by writing a <style> element. The production build emits a file instead,
// so only the dev server needs inline styles in the Content-Security-Policy.
function devStylePolicy(): Plugin {
  return {
    name: "dev-style-policy",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
    }
  };
}

export default defineConfig({
  plugins: [tailwindcss(), svelte(), devStylePolicy()],
  base: "./"
});
