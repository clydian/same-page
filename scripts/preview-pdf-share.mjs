// Local preview uses synthetic fixtures; no production data or API writes.
import { createServer } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import { createVisualFixtureSession } from "../visual-report/fixtures.mjs";
const fixture = createVisualFixtureSession();
const server = await createServer({
  configFile: false,
  define: { __SAME_PAGE_BUILD_ID__: JSON.stringify("local-pdf-share-preview") },
  server: { host: "127.0.0.1", port: 4183, strictPort: true },
  plugins: [react(), VitePWA({ registerType: "prompt" }), {
    name: "local-pdf-share-fixtures",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url, "http://localhost").pathname;
        if (!pathname.startsWith("/api/")) return next();
        const result = fixture.resolve({ pathname, method: req.method, identity: "admin", cookie: req.headers.cookie ?? "" });
        res.writeHead(result.status, { "content-type": result.contentType, ...result.headers });
        res.end(result.body);
      });
    },
  }],
});
await server.listen();
console.log("PDF share preview: http://127.0.0.1:4183/choirs/visual-choir");
