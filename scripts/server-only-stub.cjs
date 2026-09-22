/*
 * Stub for the `server-only` package, for scripts that load src/lib/db.ts
 * outside of a Next.js build.
 *
 * `server-only` is a build-time guard that Next.js resolves through its own
 * bundler. It is not an installed dependency and has no runtime behaviour: its
 * entire job is to make a build fail if a server module is imported into a
 * client bundle. Requiring it from plain Node therefore throws
 * MODULE_NOT_FOUND, which is what happens when a standalone script imports
 * src/lib/db.ts.
 *
 * This file exists so that load has something harmless to resolve to. It
 * deliberately does nothing.
 */

module.exports = {};
