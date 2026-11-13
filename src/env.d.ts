/// <reference types="vite/client" />

/** Package version, injected at build time by Vite's `define`. */
declare const __APP_VERSION__: string;

/** True in the dev server and in debug builds, false in production builds. */
declare const __SIMULATOR__: boolean;
