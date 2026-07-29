/**
 * Pure unit checks for OAuth MCP URL validation (no server required).
 * Run: npm run test:unit
 */
const assert = require("assert");
const { validateMcpUrl } = require("../src/auth/crmOAuthConfig");
const { validateRhMcpUrl } = require("../src/auth/rhOAuthConfig");

function expectThrow(fn, includes) {
  try {
    fn();
    assert.fail("expected throw");
  } catch (e) {
    assert.ok(String(e.message).includes(includes), String(e.message));
  }
}

assert.strictEqual(
  validateMcpUrl("https://crm.rapidosoftware.com/mcp"),
  "https://crm.rapidosoftware.com/mcp"
);
expectThrow(() => validateMcpUrl("http://crm.example.com/mcp"), "HTTPS");
expectThrow(() => validateMcpUrl("https://127.0.0.1/mcp"), "private");
expectThrow(() => validateRhMcpUrl("not-a-url"), "Invalid");

console.log("OK test-unit-oauth-config");
