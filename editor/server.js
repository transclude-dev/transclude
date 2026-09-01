// Language server for .html files in a transclude project.
//
// Hand-written JSON-RPC rather than a dependency. The part of the protocol
// needed here is small, and keeping it dependency-free means any editor that
// speaks LSP can use it without the project growing a toolchain.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createChecker } from '../src/typecheck.js';
import { loadProject } from '../src/project.js';

let checker = null;
let root = process.cwd();

// ---- transport -------------------------------------------------------------

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  for (;;) {
    const header = buffer.indexOf('\r\n\r\n');
    if (header === -1) return;

    const length = Number(/Content-Length: (\d+)/i.exec(buffer.slice(0, header).toString())?.[1]);
    if (!Number.isFinite(length)) return;

    const start = header + 4;
    if (buffer.length < start + length) return;

    const message = JSON.parse(buffer.slice(start, start + length).toString());
    buffer = buffer.slice(start + length);

    try {
      handle(message);
    } catch (err) {
      log(`error handling ${message.method}: ${err.stack ?? err.message}`);
    }
  }
});

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

/** stderr, so it never corrupts the protocol stream on stdout. */
function log(text) {
  process.stderr.write(`[transclude] ${text}\n`);
}

// ---- protocol --------------------------------------------------------------

function handle(message) {
  switch (message.method) {
    case 'initialize': {
      root = message.params?.rootPath ?? fileURLToPath(message.params?.rootUri ?? pathToFileURL(root).href);
      // The editor says which folder it opened, so the config is loaded from
      // there. Everything after this needs it, so nothing is answered until it
      // has arrived.
      loadProject(root)
        .then((project) => {
          checker = createChecker({ root: project.root, ...project.config });
          log(`watching ${project.root}`);
        })
        .catch((err) => log(`no project here: ${err.message}`));
      send({
        id: message.id,
        result: {
          capabilities: {
            textDocumentSync: { openClose: true, change: 1, save: true },
            hoverProvider: true,
          },
          serverInfo: { name: 'transclude', version: '0.1.0' },
        },
      });
      return;
    }

    case 'initialized':
      return;

    case 'shutdown':
      send({ id: message.id, result: null });
      return;

    case 'exit':
      process.exit(0);
      return;

    case 'textDocument/didOpen':
      publish(message.params.textDocument.uri, message.params.textDocument.text);
      return;

    case 'textDocument/didChange':
      // Full sync, so the last change carries the whole document.
      publish(message.params.textDocument.uri, message.params.contentChanges.at(-1).text);
      return;

    case 'textDocument/didSave':
      if (message.params.text !== undefined) publish(message.params.textDocument.uri, message.params.text);
      return;

    case 'textDocument/hover':
      send({ id: message.id, result: hover(message.params) });
      return;

    default:
      // Requests must be answered even when unsupported, or the client waits.
      if (message.id !== undefined) send({ id: message.id, result: null });
  }
}

function publish(uri, text) {
  if (!checker) return;
  const file = fileURLToPath(uri);
  if (!file.endsWith('.html')) return;

  checker.update(file, text);

  const diagnostics = checker.check(file).map((diagnostic) => ({
    range: rangeOf(text, diagnostic.offset, diagnostic.length),
    severity: diagnostic.severity === 'error' ? 1 : 2,
    code: `TS${diagnostic.code}`,
    source: 'transclude',
    message: diagnostic.message,
  }));

  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
}

function hover({ textDocument, position }) {
  if (!checker) return null;
  const file = fileURLToPath(textDocument.uri);
  if (!fs.existsSync(file)) return null;

  const text = fs.readFileSync(file, 'utf8');
  const info = checker.quickInfo(file, offsetOf(text, position));
  if (!info?.text) return null;

  return {
    contents: {
      kind: 'markdown',
      value: `\`\`\`ts\n${info.text}\n\`\`\`${info.documentation ? `\n\n${info.documentation}` : ''}`,
    },
  };
}

// ---- positions -------------------------------------------------------------

/** LSP counts lines and characters from zero. */
function positionOf(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length - 1;
  return { line, character: offset - (before.lastIndexOf('\n') + 1) };
}

function rangeOf(text, offset, length) {
  return { start: positionOf(text, offset), end: positionOf(text, offset + Math.max(1, length)) };
}

function offsetOf(text, position) {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < position.line && i < lines.length; i++) offset += lines[i].length + 1;
  return offset + position.character;
}

log(`ready (node ${process.version}, cwd ${path.basename(process.cwd())})`);
