import * as vscode from 'vscode';

// Define the structure for our tree items
interface DebugTreeItemData {
    label: string;
    content: string; // Content for this specific node
    children?: DebugTreeItemData[]; // For potential future nesting
}

export class AutoDebugViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Store the root items for the tree view
    private rootItems: DebugTreeItemData[] = [
        { label: "Full trace", content: "Trace details will appear here...", children: [] },
        { label: "Chain of thought", content: "LLM reasoning steps will appear here...", children: [] },
        { label: "Code suggestions etc final thoughts", content: "Suggestions and conclusions will appear here...", children: [] }
    ];

    constructor(private context: vscode.ExtensionContext) {}

    // Map our data structure to VS Code TreeItem
    private dataToTreeItem(data: DebugTreeItemData): vscode.TreeItem {
        const collapsibleState = (data.children && data.children.length > 0)
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None; // Make it collapsible only if it has children (for future)

        const item = new vscode.TreeItem(data.label, collapsibleState);
        item.description = data.content; // Show content as description for root items for now
        item.tooltip = data.content;
        // We'll use the label as the ID for simplicity for now
        item.id = data.label;
        switch (data.label) {
            case "Full trace":
                item.iconPath = new vscode.ThemeIcon('list-unordered'); // Or 'checklist', 'references'
                break;
            case "Chain of thought":
                item.iconPath = new vscode.ThemeIcon('comment-discussion'); // Or 'hubot', 'lightbulb'
                break;
            case "Code suggestions etc final thoughts":
                item.iconPath = new vscode.ThemeIcon('issues'); // Or 'lightbulb-autofix', 'beaker'
                break;
            default:
                // Optional: default icon
                item.iconPath = new vscode.ThemeIcon('circle-outline');
        }
        return item;
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        // The element itself is the TreeItem
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            // TODO: Handle children of elements if needed
            // For now, find the corresponding data item and return its children mapped to TreeItems
            // const dataItem = this.rootItems.find(item => item.label === element.label);
            // if (dataItem && dataItem.children) {
            //     return Promise.resolve(dataItem.children.map(child => this.dataToTreeItem(child)));
            // }
            return Promise.resolve([]); // No children implemented yet for root items
        } else {
            // Return the root items
            return Promise.resolve(this.rootItems.map(item => this.dataToTreeItem(item)));
        }
    }

    // --- Methods to update specific sections ---

    // Example: Update the content of a specific root node by its label
    public updateNodeContent(nodeLabel: string, newContent: string) {
        const node = this.rootItems.find(item => item.label === nodeLabel);
        if (node) {
            node.content = newContent;
            this._onDidChangeTreeData.fire(); // Refresh the entire view for simplicity
            // For more granular updates, you can fire the event with the specific item:
            // this._onDidChangeTreeData.fire(this.dataToTreeItem(node));
        } else {
            console.warn(`Node with label "${nodeLabel}" not found.`);
        }
    }

     // Example: Append content to a specific root node
    public appendNodeContent(nodeLabel: string, newText: string) {
        const node = this.rootItems.find(item => item.label === nodeLabel);
        if (node) {
            // Limit description length to avoid overly wide view items
            const MAX_DESC_LENGTH = 100;
            let updatedContent = node.content + newText;
            if (updatedContent.length > MAX_DESC_LENGTH) {
                    // Keep the end of the string
                    node.content = "..." + updatedContent.substring(updatedContent.length - MAX_DESC_LENGTH);
            } else {
                    node.content = updatedContent;
            }
            // Update tooltip with full content potentially
            // node.tooltip = node.content; // Or keep tooltip shorter?

            this._onDidChangeTreeData.fire();
        } else {
            console.warn(`Node with label "${nodeLabel}" not found.`);
        }
    }

    // Example: Clear content of a specific node
    public clearNodeContent(nodeLabel: string) {
        const node = this.rootItems.find(item => item.label === nodeLabel);
        if (node) {
            node.content = ""; // Or set to an initial placeholder
            this._onDidChangeTreeData.fire();
        } else {
            console.warn(`Node with label "${nodeLabel}" not found.`);
        }
    }

    // Method to clear all content
    public clearAllNodes() {
        this.rootItems.forEach(item => {
            // Reset to initial or empty content
            item.content = `${item.label} details will appear here...`;
            item.children = []; // Clear children if any were added
        });
        this._onDidChangeTreeData.fire();
    }
}
