import * as vscode from 'vscode';
import { BackendInterface } from './backendInterface';

// Define the structure for our tree items
interface DebugTreeItemData {
    label: string;
    content: string; // Content for this specific node
    children?: DebugTreeItemData[]; // For potential future nesting
}

export class AutoDebugViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private viewContent: string = "Waiting for debugging process to start...";
    private targets: string[] = [];
    private backend: BackendInterface;

    constructor(private context: vscode.ExtensionContext) {
        this.backend = new BackendInterface(context);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const items: vscode.TreeItem[] = [];

        if (this.targets.length > 0) {
            for (const target of this.targets) {
                const item = new vscode.TreeItem(target, vscode.TreeItemCollapsibleState.None);
                item.command = {
                    command: 'autodebug.debugTarget',
                    title: 'Debug Target',
                    arguments: [target]
                };
                items.push(item);
            }
        } else {
            items.push(new vscode.TreeItem(this.viewContent, vscode.TreeItemCollapsibleState.None));
        }

        const selectMakefileButton = new vscode.TreeItem("$(file-directory) Select Makefile", vscode.TreeItemCollapsibleState.None);
        selectMakefileButton.command = {
            command: 'autodebug.selectMakefile',
            title: 'Select Makefile'
        };
        selectMakefileButton.tooltip = 'Choose a Makefile to analyze build targets';
        items.push(selectMakefileButton);

        return Promise.resolve(items);
    }

    public updateView(content: string) {
        this.viewContent = content;
        this._onDidChangeTreeData.fire();
    }

    public appendContent(newText: string) {
        this.viewContent += newText;
        this._onDidChangeTreeData.fire();
    }

    public clearView() {
        this.viewContent = "";
        this._onDidChangeTreeData.fire();
    }

    public async loadTargetsFromMakefile(makefilePath: string) {
        const targets = await this.backend.fetchBuildTargets(makefilePath);
        this.targets = targets;
        if (targets.length === 0) {
            this.updateView("No targets found in Makefile.");
        } else {
            this.updateView("Select a target to debug.");
        }
    }

    public clearTargets() {
        this.targets = [];
        this._onDidChangeTreeData.fire();
    }
}

function createSimpleTreeItem(label: string): vscode.TreeItem {
    return new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
}
