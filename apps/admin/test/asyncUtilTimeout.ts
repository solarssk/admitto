import { configure } from "@testing-library/dom";

// `findBy*` and `waitFor` give up after 1000 ms by default. The CI runner is several times slower than a laptop (the admin suite
// takes about 8 minutes there and under 2 here), so a screen that settles in a few hundred milliseconds here can take over a
// second there, and the test fails for the clock, not for a bug. Four seconds is under the test timeout (10 s, vitest.config.ts),
// so a test that really never settles still fails with its own message.
configure({ asyncUtilTimeout: 4000 });
