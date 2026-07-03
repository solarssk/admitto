import { WEB_TEST_DATABASE_URL } from "./testEnv.js";

/** Vitest fork workers inherit CI job `DATABASE_URL` (main DB) unless overridden. */
process.env.DATABASE_URL = WEB_TEST_DATABASE_URL;
