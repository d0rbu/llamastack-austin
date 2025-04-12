// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { AutoDebugViewProvider } from './debugViewProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const autoDebugViewProvider = new AutoDebugViewProvider(context);
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
		const openDialogOptions: vscode.OpenDialogOptions = {
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
export function deactivate() {}
