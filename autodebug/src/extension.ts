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
            filters: { 'Makefiles': ['mk', 'makefile', 'Makefile'] },
            openLabel: 'Select Makefile'
        });

        if (uri && uri[0]) {
            await targetPickerProvider.loadTargets(uri[0].fsPath);
        }
    });

    const debugTargetCommand = vscode.commands.registerCommand('autodebug.debugTarget', async (target: string) => {
        const backend = new BackendInterface(context);

        vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Debugging ${target}...` },
            async () => {
                try {
                    const result = await backend.debugTarget(target) as DebugResponse;
                    autoDebugViewProvider.updateNodeContent(
                        "Full trace",
                        result.trace
                    );
                    autoDebugViewProvider.updateNodeContent(
                        "Chain of thought",
                        result.cot
                    );
                    autoDebugViewProvider.updateNodeContent(
                        "Code suggestions etc final thoughts",
                        result.answer
                    );
                } catch (err) {
                    vscode.window.showErrorMessage(`Debugging failed: ${err}`);
                }
            }
        );
        vscode.window.showInformationMessage(`Debugging target: ${target}`);
    });

    context.subscriptions.push(
        selectMakefileCommand,
        debugTargetCommand
    );
}

export function deactivate() {}
