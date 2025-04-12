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

        const selectMakefileItem = new vscode.TreeItem("Select Makefile", vscode.TreeItemCollapsibleState.None);
        selectMakefileItem.command = {
            command: 'autodebug.selectMakefile',
            title: 'Select Makefile'
        };
        selectMakefileItem.tooltip = "Choose a Makefile to analyze build targets";
        selectMakefileItem.iconPath = new vscode.ThemeIcon('file');

        return Promise.resolve([...items, selectMakefileItem]);
    }

    public async loadTargets(makefilePath: string) {
        const targetList = await this.backend.fetchBuildTargets(makefilePath);
        this.targets = targetList;
        this._onDidChangeTreeData.fire();
    }
}

function createSimpleTreeItem(label: string): vscode.TreeItem {
    return new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
}
