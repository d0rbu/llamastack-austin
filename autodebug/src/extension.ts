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

	let startDebuggingCommand = vscode.commands.registerCommand('autodebug.startDebugging', async () => {
		const relativeMakefilePath = 'agent_src/test_executables/Makefile';
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('No workspace folder open. Please open the directory containing "autodebug" and "sample".');
			return;
		}
		autoDebugViewProvider.updateNodeContent("Full trace", `Debugging started with: ${path.basename(relativeMakefilePath)}`);

		const workspaceRootUri = workspaceFolders[0].uri;
		const makefileUri = vscode.Uri.joinPath(workspaceRootUri, relativeMakefilePath);
		const makefilePath = makefileUri.fsPath;

		vscode.window.showInformationMessage(`Using Makefile: ${makefilePath}`);
		console.log(`Using Makefile path: ${makefilePath}`);

		// Update the view when debugging starts

		// TODO: Send this path to the LLM backend
		// TODO: Open a view (e.g., Webview) to display streaming output -> Now use autoDebugViewProvider.appendContent()

	});

	context.subscriptions.push(startDebuggingCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
