/**
 * DemoForge test utilities — shared helpers, mock server, and assertions.
 */

export {
  expectValidScript,
  expectRenderOutput,
  withMockLlm,
  validateDemoScript,
  loadScriptFixture,
  getFixturePath,
  FIXTURES_DIR,
  loadFixture,
  type TestScriptFixture,
} from "./test-utils.js";

export {
  createMockLlmServer,
  MockLlmServer,
  type MockLlmRequest,
  type MockLlmResponse,
  type MockLlmServerOptions,
} from "./mock-llm-server.js";
