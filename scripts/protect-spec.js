#!/usr/bin/env node
// Expected output is the contract, and an agent does not change it in passing.
//
// Claude Code runs this before every Write and Edit, with the call on stdin. A
// call that would change an expected file in `spec/cases`, or a case's
// `expect.json`, that already exists is refused with exit 2, which shows the
// message to the agent. `SPEC_EDIT=1` in the environment lets it through, for
// the `spec:` commit a person asked for. A file that does not exist yet is a
// new case being written, and passes.
//
// Every other outcome is exit 0. A hook that fails on its own is a hook that
// blocks work for no reason, and the CI check in `scripts/spec-commits.js` is
// the gate behind this one.

import fs from 'node:fs';

const PROTECTED = /(?:^|\/)spec\/cases\/[^/]+\/[^/]+\/(?:expected\/.+|expect\.json)$/;

let payload = '';
for await (const chunk of process.stdin) payload += chunk;

let file = null;
try {
  file = JSON.parse(payload || '{}').tool_input?.file_path ?? null;
} catch {
  process.exit(0);
}

if (!file || !PROTECTED.test(file) || !fs.existsSync(file)) process.exit(0);
if (process.env.SPEC_EDIT === '1') process.exit(0);

console.error(
  `${file} is expected output, and expected output is the contract: a change to ` +
    `it is a \`spec:\` commit Joe reviews. If the code is right and the file is ` +
    `wrong, say so and ask. To change it on purpose, run with SPEC_EDIT=1.`,
);
process.exit(2);
