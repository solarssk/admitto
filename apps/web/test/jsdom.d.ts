// jsdom ships no types, and the other workspaces use it only through Vitest's `environment` option.
// The registration page tests build a document themselves and drive it with the DOM API, so the
// window is typed loosely on purpose.
declare module "jsdom" {
  export interface JSDOMOptions {
    runScripts?: "dangerously" | "outside-only";
    pretendToBeVisual?: boolean;
    url?: string;
  }
  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly window: any;
    serialize(): string;
  }
}
