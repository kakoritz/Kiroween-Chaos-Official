// Type shims for the haunt sources the browser entry bundles. The Vite plugin in vite.config.ts stubs node:fs at build time.
declare module 'node:fs' {
  export const closeSync: any, existsSync: any, fsyncSync: any, openSync: any, readFileSync: any, writeSync: any;
}
declare const process: { env: Record<string, string | undefined>; pid: number };
