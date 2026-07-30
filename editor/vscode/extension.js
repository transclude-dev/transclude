// Starts the language server for workspaces that look like an html-first
// project. Anything else is left alone. The grammar is harmless everywhere, and
// the checker only makes sense where html-first.config.js exists.

const path = require('node:path');
const fs = require('node:fs');
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

let client;

function activate(context) {
  if (!vscode.workspace.getConfiguration('htmlFirst').get('enable')) return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const root = folder.uri.fsPath;
  if (!fs.existsSync(path.join(root, 'html-first.config.js'))) return;

  client = new LanguageClient(
    'htmlFirst',
    'html-first',
    {
      run: { module: path.join(root, 'framework/editor/server.js'), transport: TransportKind.stdio },
      debug: { module: path.join(root, 'framework/editor/server.js'), transport: TransportKind.stdio },
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
