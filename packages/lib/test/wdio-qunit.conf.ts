export const config = {
  runner: "local",
  specs: [],
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless"],
      },
    },
  ],
  services: [
    [
      "qunit",
      {
        paths: ["/test-resources/ui5/model/signal/qunit/testsuite.qunit.html"],
      },
    ],
  ],
  reporters: ["spec"],
  baseUrl: process.env["TEST_BASE_URL"] || "http://localhost:8080",
};
