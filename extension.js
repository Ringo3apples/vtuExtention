const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const VIEW_TYPE = 'vtuNodeProcessor.vtuEditor';
const SHARED_VIEW_TYPE = 'vtuNodeProcessor.sharedViewer';

let sharedViewerPanel = null;
let sharedViewerReady = false;
let pendingSharedVtuUri = null;

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
 * @param {{ onReady?: () => Promise<void> | void, onVtuLoaded?: (uri: vscode.Uri) => void }} [hooks]
 * @returns {vscode.Disposable}
 */
function attachWebviewHandlers(webview, hooks = {}) {
  return webview.onDidReceiveMessage(async (msg) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'ready': {
        if (hooks.onReady) {
          await hooks.onReady();
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
          if (hooks.onVtuLoaded) {
            hooks.onVtuLoaded(selected[0]);
          }
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
 * Open or reuse the single shared VTU viewer panel and stream the selected .vtu file into it
 * without resetting the existing 3D view or node graph.
 * @param {vscode.Uri | undefined} fileUri
 * @param {vscode.ExtensionContext} context
 * @param {{ preserveFocus?: boolean }} [options]
 */
async function openInSharedViewer(fileUri, context, options = {}) {
  const preserveFocus = Boolean(options.preserveFocus);
  const titleForUri = (uri) =>
    uri ? `VTU: ${path.basename(uri.fsPath || uri.path)}` : 'VTU Node Processor';

  if (sharedViewerPanel) {
    if (fileUri) {
      sharedViewerPanel.title = titleForUri(fileUri);
      if (sharedViewerReady) {
        await postVtuFile(sharedViewerPanel.webview, fileUri);
      } else {
        pendingSharedVtuUri = fileUri;
      }
    }
    sharedViewerPanel.reveal(sharedViewerPanel.viewColumn, preserveFocus);
    return;
  }

  sharedViewerReady = false;
  pendingSharedVtuUri = fileUri || null;

  sharedViewerPanel = vscode.window.createWebviewPanel(
    SHARED_VIEW_TYPE,
    titleForUri(fileUri),
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri]
    }
  );
  sharedViewerPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
  sharedViewerPanel.webview.html = getWebviewHtml(sharedViewerPanel.webview, context.extensionUri);

  const messageDisposable = attachWebviewHandlers(sharedViewerPanel.webview, {
    onReady: async () => {
      sharedViewerReady = true;
      if (pendingSharedVtuUri && sharedViewerPanel) {
        const uriToLoad = pendingSharedVtuUri;
        pendingSharedVtuUri = null;
        await postVtuFile(sharedViewerPanel.webview, uriToLoad);
      }
    },
    onVtuLoaded: (loadedUri) => {
      if (sharedViewerPanel) {
        sharedViewerPanel.title = titleForUri(loadedUri);
      }
    }
  });

  sharedViewerPanel.onDidDispose(() => {
    sharedViewerPanel = null;
    sharedViewerReady = false;
    pendingSharedVtuUri = null;
    messageDisposable.dispose();
  });
}

/**
 * Resolve a .vtu URI from command argument, active editor, or file open dialog.
 * @param {vscode.Uri | undefined} uri
 * @returns {Promise<vscode.Uri | undefined>}
 */
async function resolveTargetVtuUri(uri) {
  if (uri) return uri;

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri && activeUri.fsPath.toLowerCase().endsWith('.vtu')) {
    return activeUri;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'VTUファイルを開く',
    filters: {
      'VTU Files': ['vtu'],
      'All Files': ['*']
    }
  });
  return selected && selected.length > 0 ? selected[0] : undefined;
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
    const singleViewerMode = vscode.workspace
      .getConfiguration('vtuNodeProcessor')
      .get('singleViewerMode', true);

    if (singleViewerMode) {
      await openInSharedViewer(document.uri, this.context, { preserveFocus: true });
      setTimeout(() => {
        webviewPanel.dispose();
      }, 0);
      return;
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewPanel.webview.html = getWebviewHtml(webviewPanel.webview, this.context.extensionUri);

    const messageDisposable = attachWebviewHandlers(webviewPanel.webview, {
      onReady: async () => {
        await postVtuFile(webviewPanel.webview, document.uri);
      }
    });
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
    vscode.commands.registerCommand('vtuNodeProcessor.openInSharedViewer', async (uri) => {
      const targetUri = await resolveTargetVtuUri(uri);
      if (!targetUri) return;
      await openInSharedViewer(targetUri, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vtuNodeProcessor.openFile', async (uri) => {
      const targetUri = await resolveTargetVtuUri(uri);
      if (!targetUri) return;

      const singleViewerMode = vscode.workspace
        .getConfiguration('vtuNodeProcessor')
        .get('singleViewerMode', true);

      if (singleViewerMode) {
        await openInSharedViewer(targetUri, context);
      } else {
        await vscode.commands.executeCommand('vscode.openWith', targetUri, VIEW_TYPE);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vtuNodeProcessor.openViewer', async () => {
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      const vtuUri =
        activeUri && activeUri.fsPath.toLowerCase().endsWith('.vtu') ? activeUri : undefined;
      await openInSharedViewer(vtuUri, context);
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
