import * as vscode from 'vscode';
import { BackendInterface } from './backendInterface';

export class TargetPickerViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

    private targets: string[] = [];
    private backend: BackendInterface;

    constructor(private context: vscode.ExtensionContext) {
        this.backend = new BackendInterface(context);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): Thenable<vscode.TreeItem[]> {
        const items: vscode.TreeItem[] = this.targets.map(t => {
            const item = new vscode.TreeItem(t, vscode.TreeItemCollapsibleState.None);
            item.command = {
                command: 'autodebug.debugTarget',
                title: 'Debug Target',
                arguments: [t]
            };
            return item;
        });

        return Promise.resolve(items);
    }

    public async loadTargets(makefilePath: string) {
        try {
            const targetList = await this.backend.fetchBuildTargets(makefilePath);
            if (targetList && targetList.length > 0) {
                 this.targets = targetList;
            } else {
                 this.targets = ["No build targets found in selected Makefile."];
            }
            this._onDidChangeTreeData.fire();
        } catch (error) {
             console.error("Error fetching build targets:", error);
             this.targets = ["Error fetching targets."];
             vscode.window.showErrorMessage(`Error fetching targets: ${error}`);
             this._onDidChangeTreeData.fire();
        }
    }

    // Add a method to clear targets, maybe called before loading new ones
    public clearTargets() {
        this.targets = ["Click 'Select Makefile' button above..."];
        this._onDidChangeTreeData.fire();
    }
}

function createSimpleTreeItem(label: string): vscode.TreeItem {
    return new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
}
