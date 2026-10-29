/**
 * Code that contains this text gets the mock sandbox's error fixture; any other code gets the
 * success fixture. The scenarios for `mock` mode put it in the code they "generate" for a failing
 * attempt. A module of its own so that the scenario fixtures, which the E2E specs load with Node's
 * native ESM loader, do not pull in the JSON fixtures that `mock.ts` imports.
 */
export const MOCK_ERROR_MARKER = "# sandbox:error";
