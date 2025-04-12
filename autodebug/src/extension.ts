import * as vscode from 'vscode';
import { AutoDebugViewProvider } from './debugViewProvider';
import { TargetPickerViewProvider } from './targetPickerViewProvider';
import * as path from 'path';
import { BackendInterface, DebugResponse } from './backendInterface';

export function activate(context: vscode.ExtensionContext) {
    const autoDebugViewProvider = new AutoDebugViewProvider(context);
    vscode.window.registerTreeDataProvider('autodebugView', autoDebugViewProvider);
    vscode.window.createTreeView('autodebugView', {
        treeDataProvider: autoDebugViewProvider,
    });

    const targetPickerProvider = new TargetPickerViewProvider(context);
    vscode.window.registerTreeDataProvider('targetPickerView', targetPickerProvider);
    vscode.window.createTreeView('targetPickerView', {
        treeDataProvider: targetPickerProvider,
    });

    const selectMakefileCommand = vscode.commands.registerCommand('autodebug.selectMakefile', async () => {
        const uri = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Select Makefile'
        });

        if (uri && uri[0]) {
            await targetPickerProvider.loadTargets(uri[0].fsPath);
        }
    });

    const debugTargetCommand = vscode.commands.registerCommand('autodebug.debugTarget', async (target: string) => {
        const backend = new BackendInterface(context);
    
        const bugDescription = await vscode.window.showInputBox({
            prompt: 'Describe the bug or unexpected behavior you are encountering.',
            placeHolder: 'e.g., segfault when input is empty'
        });
    
        if (!bugDescription) {
            vscode.window.showWarningMessage('Debugging canceled: no bug description provided.');
            return;
        }
    
        vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Debugging ${target}...` },
            async (progress, token) => {
                try {
                    progress.report({ increment: 0 });
    
                    // Initialize the node content
                    autoDebugViewProvider.setNodeContent("trace", [], "Debugging");
                    autoDebugViewProvider.setNodeContent("cot", [], "Waiting to finish debugging");
                    autoDebugViewProvider.setNodeContent("suggestions", [], "Waiting to finish debugging");
    
                    // Buffers for the incoming streams
                    const traceLines: string[] = [];
                    const cotLines: string[] = [];
                    const suggestionLines: string[] = [];
    
                    // Call the backend method to start debugging and get the stream
                    const debugStream = backend.debugTarget(target, bugDescription);
    
                    // Iterate over the async generator to process each DebugResponse
                    for await (const result of debugStream) {
                        if (result.type === 'trace') {
                            traceLines.push(result.content);
                            autoDebugViewProvider.setNodeContent("trace", traceLines, `${traceLines.length} trace lines`);
                        } else if (result.type === 'cot') {
                            cotLines.push(result.content);
                            autoDebugViewProvider.setNodeContent("cot", cotLines, `${cotLines.length} reasoning steps`);
                        } else if (result.type === 'answer') {
                            suggestionLines.push(result.content);
                            autoDebugViewProvider.setNodeContent("suggestions", suggestionLines, "Compiling suggestions");
                        }
                    }
    
                    // Final updates after the stream has finished
                    autoDebugViewProvider.setNodeContent("suggestions", suggestionLines, "Ready");
                    progress.report({ increment: 100, message: "Debugging complete!" });
    
                } catch (err) {
                    vscode.window.showErrorMessage(`Debugging failed: ${err}`);
                }
            }
        );
    });    

    context.subscriptions.push(
        selectMakefileCommand,
        debugTargetCommand
    );
}

export function deactivate() {}
