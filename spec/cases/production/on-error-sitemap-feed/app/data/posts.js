// A database that is up for the build and down for the server. The first
// process to read it owns it, and any other process finds it gone. The build
// is one process, and its worker threads share its pid.
import fs from 'node:fs';
import path from 'node:path';

const owner = path.resolve('database-owner.txt');

export function posts() {
  if (!fs.existsSync(owner)) fs.writeFileSync(owner, String(process.pid));
  if (fs.readFileSync(owner, 'utf8') !== String(process.pid)) throw new Error('the database is down');
  return [{ slug: 'first', title: 'First' }];
}
