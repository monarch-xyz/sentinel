/**
 * Canonical application entrypoint.
 *
 * The real API bootstrap lives in src/api/index.ts. Keeping this file thin
 * avoids maintaining two diverging server implementations.
 */
import "./api/index.js";
