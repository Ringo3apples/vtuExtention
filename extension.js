const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const VIEW_TYPE = 'vtuNodeProcessor.vtuEditor';

/**
 * Send a VTU file's binary contents to the webview.
 * @param {vscode.Webview} webview
 * @param {vscode.Uri} fileUri
 */
async function postVtuFile(webview, fileUri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    const base64 = Buffer.from(bytes).toString('base64');
    await webview.postMessage({
      type: 'loadVTU',
      fileName: path.basename(fileUri.fsPath || fileUri.path),
      base64
    });
  } catch (err) {
    vscode.window.showErrorMessage(`VTUファイルの読み込みに失敗しました: ${err.message}`);
  }
}

/**
 * Build webview HTML by loading vtu_node_processor.html and rewriting
 * Three.js importmap URLs to local extension resources.
 * @param {vscode.Webview} webview
 * @param {vscode.Uri} extensionUri
 * @returns {string}
 */
function getWebviewHtml(webview, extensionUri) {
  const htmlPath = path.join(extensionUri.fsPath, 'vtu_node_processor.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  const threeModuleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'node_modules', 'three', 'build', 'three.module.js')
  );
  const threeWebgpuUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'node_modules', 'three', 'build', 'three.webgpu.js')
  );

  const localImportMap = `<script type="importmap">
  {
    "imports": {
      "three": "${threeModuleUri}",
      "three/webgpu": "${threeWebgpuUri}",
      "three/tsl": "${threeWebgpuUri}"
    }
  }
  </script>`;

  html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, localImportMap);
  return html;
}

/**
 * Attach message handlers between the VSCode extension host and the webview.
 * @param {vscode.Webview} webview
 * @param {vscode.Uri | undefined} initialUri
 * @returns {vscode.Disposable}
 */
function attachWebviewHandlers(webview, initialUri) {
  return webview.onDidReceiveMessage(async (msg) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'ready': {
        if (initialUri) {
          await postVtuFile(webview, initialUri);
        }
        break;
      }

      case 'openVtuDialog': {
        const selected = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'VTUファイルを開く',
          filters: {
            'VTU Files': ['vtu'],
            'All Files': ['*']
          }
        });
        if (selected && selected.length > 0) {
          await postVtuFile(webview, selected[0]);
        }
        break;
      }

      case 'openFlowDialog': {
        const selected = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'ノード設定を読み込む',
          filters: {
            'JSON Files': ['json'],
            'All Files': ['*']
          }
        });
        if (selected && selected.length > 0) {
          try {
            const bytes = await vscode.workspace.fs.readFile(selected[0]);
            const jsonText = Buffer.from(bytes).toString('utf8');
            await webview.postMessage({ type: 'loadFlow', jsonText });
          } catch (err) {
            vscode.window.showErrorMessage(`ノード設定の読み込みに失敗しました: ${err.message}`);
          }
        }
        break;
      }

      case 'saveFlowDialog': {
        const defaultName = msg.defaultName || 'vtu_pipeline.json';
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const defaultUri = workspaceFolder
          ? vscode.Uri.joinPath(workspaceFolder, defaultName)
          : vscode.Uri.file(defaultName);

        const targetUri = await vscode.window.showSaveDialog({
          defaultUri,
          saveLabel: 'ノード設定を保存',
          filters: {
            'JSON Files': ['json']
          }
        });

        if (targetUri) {
          try {
            const data = Buffer.from(msg.jsonText || '', 'utf8');
            await vscode.workspace.fs.writeFile(targetUri, data);
            await webview.postMessage({
              type: 'savedFlow',
              fileName: path.basename(targetUri.fsPath || targetUri.path)
            });
          } catch (err) {
            vscode.window.showErrorMessage(`ノード設定の保存に失敗しました: ${err.message}`);
          }
        }
        break;
      }

      case 'error': {
        if (msg.message) {
          vscode.window.showErrorMessage(msg.message);
        }
        break;
      }
    }
  });
}

/**
 * Custom readonly editor provider for .vtu files.
 */
class VtuEditorProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.context = context;
  }

  /**
   * @param {vscode.Uri} uri
   */
  async openCustomDocument(uri) {
    return {
      uri,
      dispose() {}
    };
  }

  /**
   * @param {{ uri: vscode.Uri }} document
   * @param {vscode.WebviewPanel} webviewPanel
   */
  async resolveCustomEditor(document, webviewPanel) {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewPanel.webview.html = getWebviewHtml(webviewPanel.webview, this.context.extensionUri);

    const messageDisposable = attachWebviewHandlers(webviewPanel.webview, document.uri);
    webviewPanel.onDidDispose(() => {
      messageDisposable.dispose();
    });
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const provider = new VtuEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      },
      supportsMultipleEditorsPerDocument: false
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vtuNodeProcessor.openFile', async (uri) => {
      let targetUri = uri;
      if (!targetUri && vscode.window.activeTextEditor) {
        const activeUri = vscode.window.activeTextEditor.document.uri;
        if (activeUri.fsPath.toLowerCase().endsWith('.vtu')) {
          targetUri = activeUri;
        }
      }
      if (!targetUri) {
        const selected = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'VTUファイルを開く',
          filters: {
            'VTU Files': ['vtu'],
            'All Files': ['*']
          }
        });
        if (!selected || selected.length === 0) return;
        targetUri = selected[0];
      }
      await vscode.commands.executeCommand('vscode.openWith', targetUri, VIEW_TYPE);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vtuNodeProcessor.openViewer', async () => {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      if (activeUri && activeUri.fsPath.toLowerCase().endsWith('.vtu')) {
        await vscode.commands.executeCommand('vscode.openWith', activeUri, VIEW_TYPE);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'vtuNodeProcessor.standalone',
        'VTU Node Processor',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri]
        }
      );

      panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);
      const messageDisposable = attachWebviewHandlers(panel.webview, undefined);
      panel.onDidDispose(() => {
        messageDisposable.dispose();
      });
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};

