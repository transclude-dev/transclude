// Starts the language server for workspaces that look like an transclude
// project. Anything else is left alone. The grammar is harmless everywhere, and
// the checker only makes sense where transclude.config.js exists.

const path = require('node:path');
const fs = require('node:fs');
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client;

function activate(context) {
  if (!vscode.workspace.getConfiguration('transclude').get('enable')) return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const root = folder.uri.fsPath;
  if (!fs.existsSync(path.join(root, 'transclude.config.js'))) return;

  // Installed, the server is in the package. In the framework's own repo it is
  // beside this file. Try both rather than assume a layout.
  const server = [
    path.join(root, 'node_modules/transclude/editor/server.js'),
    path.join(root, 'editor/server.js'),
  ].find((file) => fs.existsSync(file));
  if (!server) return;

  client = new LanguageClient(
    'transclude',
    'transclude',
    {
      run: { module: server, transport: TransportKind.stdio },
      debug: { module: server, transport: TransportKind.stdio },
    },
    {
      documentSelector: [{ scheme: 'file', language: 'html' }],
      synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.html') },
    },
  );

  context.subscriptions.push(client.start());
}

function deactivate() {
  return client?.stop();
}

module.exports = { activate, deactivate };
