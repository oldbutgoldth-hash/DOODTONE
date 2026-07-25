/**
 * qa/helpers/ensure-vm-modules-flag.mjs
 *
 * LOCAL-FIRST GEOMETRY R3 -- Phase A3 support helper.
 *
 * `vm.SourceTextModule` (the real ESM parse goal used by the syntax gate
 * and its regression test) is only available when the Node process is
 * launched with --experimental-vm-modules. Rather than requiring every
 * caller (npm scripts, the static-suite runner, a developer's own
 * terminal) to remember that flag, this helper self-relaunches the
 * CURRENT script as a child process with the flag added, inherits
 * stdio, and exits with the child's exact exit code -- transparent to
 * the caller either way.
 *
 * Call `ensureVmModulesFlag()` as the very first statement in any
 * script's isMainModule block that needs vm.SourceTextModule. It is a
 * no-op (returns immediately) if the flag is already active.
 */

import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

export function ensureVmModulesFlag() {
  if (typeof vm.SourceTextModule === 'function') {
    return; // Already available -- no-op.
  }
  const child = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', ...process.argv.slice(1)],
    { stdio: 'inherit' }
  );
  if (child.error) {
    console.error('[ensure-vm-modules-flag] Failed to relaunch with --experimental-vm-modules:', child.error.message);
    process.exit(2);
  }
  process.exit(child.status === null ? 2 : child.status);
}
