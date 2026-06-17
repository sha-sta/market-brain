// Empty stand-in for the `server-only` package so server-side IO modules (which import it purely to
// fail a CLIENT bundle) can be imported by the node-based vitest runner. Aliased in
// vitest.integration.config.ts. Mirrors how Next apps stub `server-only` in tests.
export {};
