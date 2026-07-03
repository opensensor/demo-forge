/**
 * Mock web app server for E2E tests.
 * Serves static files from test/fixtures/mock-web-app/ using http-server.
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.MOCK_WEB_PORT || "3000", 10);
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "mock-web-app");

async function main(): Promise<void> {
  console.log(`Mock web app server starting on port ${PORT}...`);
  console.log(`Serving from: ${FIXTURES_DIR}`);

  const server = spawn("npx", ["http-server", FIXTURES_DIR, "-p", String(PORT), "-c-1", "--cors"], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
    env: { ...process.env, NODE_ENV: "test" },
  });

  server.on("error", (err) => {
    console.error(`Failed to start mock web app server: ${err.message}`);
    process.exit(1);
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  console.log(`Mock web app server ready at http://localhost:${PORT}`);
  console.log("Pages available:");
  console.log(`  - http://localhost:${PORT}/ (home)`);
  console.log(`  - http://localhost:${PORT}/login (login page)`);
  console.log(`  - http://localhost:${PORT}/dashboard (dashboard)`);
  console.log(`  - http://localhost:${PORT}/form (contact form)`);

  process.on("SIGINT", () => { server.kill("SIGINT"); process.exit(0); });
  process.on("SIGTERM", () => { server.kill("SIGTERM"); process.exit(0); });
}

main().catch((err) => { console.error(err); process.exit(1); });
