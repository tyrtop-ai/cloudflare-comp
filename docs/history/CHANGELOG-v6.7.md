# v6.7 Container lifecycle fix

Rebased on the complete v6.6 ZIP (no state or binding rename).

- Corrects container start for default scheduling policy (`start()` with no options).
- Retains `exec()` on startup, with bounded retry for transient cold-start RPC errors.
- Replaces ineffective timeout signaling with `Promise.race` and `ExecProcess.kill(9)`; uses a separate GNU `timeout` wrapper to terminate process groups, and runner SIGTERM handlers to clean detached subprocesses.
- Treats absent/rejected `setInactivityTimeout` as a log-only optimization failure.
- Adds five regression tests (138/138 total locally).
- The user-supplied run export ends paused on a separate hidden-child export-name error; not fixed by these Container changes.

Deployment: `npm install && npm test && npm run check && npm run deploy`. See full install guide. No live deployment was performed here.
