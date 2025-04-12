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

        vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Debugging ${target}...` },
            async (progress, token) => {
                try {
                    progress.report({ increment: 0 });

                    autoDebugViewProvider.setNodeContent(
                        "trace",
                        [],
                        "Debugging"
                    );
                    autoDebugViewProvider.setNodeContent(
                        "cot",
                        [],
                        "Waiting to finish debugging"
                    );
                    autoDebugViewProvider.setNodeContent(
                        "suggestions",
                        [],
                        "Waiting to finish debugging"
                    );
                    const result = await backend.debugTarget(target) as DebugResponse;

                    // wait 5 seconds
                    await new Promise(resolve => setTimeout(resolve, 5000));

					const traceLines = (result.trace || "No trace received.").split('\n');
					const cotLines = (result.cot || "No CoT received.").split('\n');
                    const suggestionLines = (result.answer || "No suggestions received.").split('\n');
                    
                    autoDebugViewProvider.setNodeContent(
                        "trace",
                        traceLines,
                        `${traceLines.length} trace lines`
                    );

                    autoDebugViewProvider.setNodeContent(
                        "cot",
                        cotLines,
                        `${cotLines.length} reasoning steps`
                    );

                    autoDebugViewProvider.setNodeContent(
                        "suggestions",
                        suggestionLines,
                        "Ready"
                    )

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
