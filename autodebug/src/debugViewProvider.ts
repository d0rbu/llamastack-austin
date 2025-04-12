import * as vscode from 'vscode';

export class AutoDebugViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Store the messages or data to display
    private viewContent: string = "Waiting for debugging process to start...";

    constructor(private context: vscode.ExtensionContext) {}

    // Required method: Get the tree item representation
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    // Required method: Get the children of an element or the root elements
    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        // For now, we don't have a tree structure, just a single message.
        // If element is defined, it means we are asking for children of an item, return empty.
        if (element) {
            return Promise.resolve([]);
        }

        // If element is undefined, we are asking for the root elements.
        // Return a single item with the current content.
        const item = new vscode.TreeItem(this.viewContent, vscode.TreeItemCollapsibleState.None);
        // Optionally add a tooltip or command
        item.tooltip = "Current status of the Auto Debugger";
        // item.command = { command: 'autodebug.someAction', title: "Action", arguments: [] };
        return Promise.resolve([item]);

    }

    // Method to update the content and refresh the view
    public updateView(content: string) {
        this.viewContent = content;
        this._onDidChangeTreeData.fire(); // Signal VS Code that the view data has changed
    }

    // Method to append content (useful for streaming)
    public appendContent(newText: string) {
        this.viewContent += newText;
        this._onDidChangeTreeData.fire();
    }

    // Method to clear the content
    public clearView() {
        this.viewContent = "";
        this._onDidChangeTreeData.fire();
    }
}

// Helper function to create a simple TreeItem
function createSimpleTreeItem(label: string): vscode.TreeItem {
    return new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
}