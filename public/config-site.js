'use strict';

/**
 * Deployment mode for the dashboard pages.
 *
 * The committed default runs against the local Express server (npm start).
 * The CI build overwrites this file to flip the pages into static mode, where
 * they read the data/*.json files published by scripts/run-once.js instead of
 * the live /api/* endpoints. See scripts/assemble-site.js.
 */
window.MONITOR_STATIC = false;
