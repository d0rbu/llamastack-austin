"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const debugViewProvider_1 = require("./debugViewProvider");
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    const autoDebugViewProvider = new debugViewProvider_1.AutoDebugViewProvider(context);
    vscode.window.registerTreeDataProvider('autodebugView', autoDebugViewProvider);
    vscode.window.createTreeView('autodebugView', {
        treeDataProvider: autoDebugViewProvider,
    });
    let disposable = vscode.commands.registerCommand('autodebug.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from autodebug!');
    });
    context.subscriptions.push(disposable);
    let selectAndStartCommand = vscode.commands.registerCommand('autodebug.selectBuildTargetAndStart', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a workspace first.');
            return;
        }
        const workspaceRootUri = workspaceFolders[0].uri;
        const openDialogOptions = {
            canSelectMany: false,
            openLabel: 'Select Build Target',
            // defaultUri: workspaceRootUri, // Optional: Start in workspace root
            canSelectFiles: true,
            canSelectFolders: false
        };
        const fileUriArray = await vscode.window.showOpenDialog(openDialogOptions);
        if (!fileUriArray || fileUriArray.length === 0) {
            vscode.window.showInformationMessage('No build target file selected. Debugging cancelled.');
            // Optionally reset the view to its initial state
            // autoDebugViewProvider.clearAllNodes();
            // autoDebugViewProvider.updateNodeContent("Full trace", "Waiting for build target selection...");
            return; // User cancelled the dialog
        }
        const selectedFileUri = fileUriArray[0];
        const selectedFilePath = selectedFileUri.fsPath; // Get the file system path
        vscode.window.showInformationMessage(`Selected build target: ${selectedFilePath}`);
        console.log(`Using selected build target path: ${selectedFilePath}`);
        // Update the view provider with the selected file name
        autoDebugViewProvider.clearAllNodes(); // Clear previous state
        autoDebugViewProvider.updateNodeContent("Full trace", `Ready to debug: ${path.basename(selectedFilePath)}`);
        autoDebugViewProvider.updateNodeContent("Chain of thought", "Waiting for LLM analysis...");
        autoDebugViewProvider.updateNodeContent("Code suggestions etc final thoughts", "Waiting for suggestions...");
        // TODO: Send the selectedFilePath to the LLM backend
        // TODO: Use autoDebugViewProvider.appendNodeContent() for streaming output
    });
    context.subscriptions.push(selectAndStartCommand);
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map