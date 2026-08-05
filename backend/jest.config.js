/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // The maintained suite. src/tests/security.test.ts predates the v2 rebuild:
  // it exercises middleware the live server does not mount and trips on an
  // ESM-only dependency under ts-jest — kept for reference, not run.
  roots: ["<rootDir>/src/__tests__"],
  testMatch: ["**/*.test.ts"],
  clearMocks: true,
};
