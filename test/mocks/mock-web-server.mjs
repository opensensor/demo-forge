/**
 * Mock web app server for E2E tests.
 * Zero-dependency static server for test/fixtures/mock-web-app/ that maps
 * extensionless routes (/login, /dashboard, /form) to their .html files.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.MOCK_WEB_PORT || "3000", 10);
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "mock-web-app");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  if (clean === "/" || clean === "") return join(FIXTURES_DIR, "index.html");
  const withExt = extname(clean) ? clean : `${clean}.html`;
  return join(FIXTURES_DIR, withExt);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const filePath = resolvePath(url.pathname);
  if (!filePath.startsWith(FIXTURES_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end(`Not found: ${url.pathname}`);
  }
});

server.listen(PORT, () => {
  console.log(`Mock web app server ready at http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
