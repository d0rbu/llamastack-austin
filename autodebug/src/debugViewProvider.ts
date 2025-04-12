// Define the structure for our tree items
interface DebugTreeItemData {
    id: string; // Unique ID for the item
    label: string; // Display label
    description?: string; // Optional: Text shown next to the label
    content?: string; // Optional: Raw content (full markdown for CoT/Suggestions)
    children: DebugTreeItemData[]; // Children nodes
    isCategory: boolean; // Flag to distinguish category nodes from content lines
    icon?: vscode.ThemeIcon; // Optional specific icon
    command?: vscode.Command; // Optional command for the tree item
}


import * as vscode from 'vscode';
import { BackendInterface } from './backendInterface';

export class AutoDebugViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Store the root items for the tree view
    private rootItems: DebugTreeItemData[] = [
        { id: "trace", label: "Full trace", description: "Awaiting debug process...", children: [], isCategory: true, icon: new vscode.ThemeIcon('list-unordered') },
        { id: "cot", label: "Chain of thought", description: "Awaiting debug process...", children: [], isCategory: true, icon: new vscode.ThemeIcon('comment-discussion') },
        { id: "suggestions", label: "Code suggestions etc final thoughts", description: "Awaiting debug process...", children: [], isCategory: true, icon: new vscode.ThemeIcon('issues') }
    ];

    private contentCounter = 0;


    constructor(private context: vscode.ExtensionContext) {}

    // Map our data structure to VS Code TreeItem
    private dataToTreeItem(data: DebugTreeItemData): vscode.TreeItem {
        const collapsibleState = (data.children && data.children.length > 0)
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None; // Make it collapsible only if it has children (for future)

        const item = new vscode.TreeItem(data.label, collapsibleState);
        item.id = data.id;
        item.tooltip = data.content || data.label;
        item.iconPath = data.icon;
        item.description = data.description;
        item.command = data.command;
        if (!data.isCategory) {
            // For regular trace lines
            if (!item.command) { // Don't override formatting for command items
                 const MAX_LABEL_LENGTH = 150;
                 if (item.label && typeof item.label === 'string' && item.label.length > MAX_LABEL_LENGTH) {
                    item.label = item.label.substring(0, MAX_LABEL_LENGTH) + "...";
                 }
                 // Use 'dash' icon for simple lines
                 item.iconPath = item.iconPath || new vscode.ThemeIcon('dash');
                 item.description = undefined; // Content lines shouldn't have descriptions
            } else {
                 // For special single children (CoT, Suggestions) that have commands
                 item.iconPath = item.iconPath || new vscode.ThemeIcon('go-to-file'); // Icon indicating action
                 item.tooltip = "Click to view full content"; // More specific tooltip
            }
        }

        return item;
    }
    private findNodeById(id: string, nodes: DebugTreeItemData[]): DebugTreeItemData | undefined {
        for (const node of nodes) {
            if (node.id === id) {
                return node;
            }
            // Recursively search children
            const foundInChildren = this.findNodeById(id, node.children);
            if (foundInChildren) {
                return foundInChildren;
            }
        }
        return undefined;
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        // The element itself is the TreeItem
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element && element.id) {
            const parentData = this.findNodeById(element.id, this.rootItems);
            if (parentData) {
                // Type child explicitly
                return Promise.resolve(parentData.children.map((child: DebugTreeItemData) => this.dataToTreeItem(child)));
            }
        } else {
            // Type item explicitly
            return Promise.resolve(this.rootItems.map((item: DebugTreeItemData) => this.dataToTreeItem(item)));
        }
        return Promise.resolve([]);
    }

    // --- Methods to update specific sections ---
    private findRootNode(nodeId: string): DebugTreeItemData | undefined {
        return this.rootItems.find(item => item.id === nodeId);
    }

    public updateNodeDescription(nodeId: string, newDescription: string) {
        const node = this.findRootNode(nodeId);
        if (node && node.isCategory) {
            node.description = newDescription;
            this._onDidChangeTreeData.fire(); // Refresh needed to show description change
        } else {
             console.warn(`Category node with id "${nodeId}" not found for updating description.`);
        }
    }

    public setNodeContent(nodeId: string, content: string[] | string, description?: string) {
        const node = this.findRootNode(nodeId);
        if (!node || !node.isCategory) {
             console.warn(`Category node with id "${nodeId}" not found for setting content.`);
             return;
        }

        let childLabel = "View Content"; // Default label
        let fullContentString: string;
        let commandArgs: [string, string]; // [content, title]

        if (nodeId === 'trace') {
            if (Array.isArray(content)) {
                fullContentString = content.join('\n');
                childLabel = "View Full Trace";
                node.description = description ?? (content.length > 0 ? `(${content.length} lines)` : "(empty)");
            } else if (typeof content === 'string') {
                // Allow setting trace from a single string too
                fullContentString = content;
                childLabel = "View Full Trace";
                node.description = description ?? (content ? "(Content available)" : "(empty)");
            } else {
                console.warn(`Invalid content type for trace node. Expected string[] or string.`);
                node.children = [];
                node.description = description ?? "(Invalid content)";
                this._onDidChangeTreeData.fire();
                return;
            }
            commandArgs = [fullContentString, "Full Debug Trace"];

        } else if (nodeId === 'cot') {
            if (typeof content === 'string') {
                fullContentString = content;
                childLabel = "View Chain of Thought";
                node.description = description ?? (content ? "(Content available)" : "(empty)");
                commandArgs = [fullContentString, "Chain of Thought"];
            } else {
                 console.warn(`Invalid content type for cot node. Expected string.`);
                 node.children = [];
                 node.description = description ?? "(Invalid content)";
                 this._onDidChangeTreeData.fire();
                 return;
            }

        } else if (nodeId === 'suggestions') {
            if (typeof content === 'string') {
                fullContentString = content;
                childLabel = "View Suggestions";
                node.description = description ?? (content ? "(Content available)" : "(empty)");
                commandArgs = [fullContentString, "Suggestions & Final Thoughts"];
            } else {
                 console.warn(`Invalid content type for suggestions node. Expected string.`);
                 node.children = [];
                 node.description = description ?? "(Invalid content)";
                 this._onDidChangeTreeData.fire();
                 return;
            }
        } else {
             console.warn(`Unknown nodeId for setNodeContent: ${nodeId}`);
             node.children = [];
             node.description = description ?? "(Unknown node type)";
             this._onDidChangeTreeData.fire();
             return;
        }

        // Create the single child item for all categories
        const childId = `${nodeId}_content_${this.contentCounter++}`;
        node.children = [{
             id: childId,
             label: childLabel,
             content: fullContentString, // Store the full content here
             children: [],
             isCategory: false,
             command: {
                 command: 'autodebug.showContentWebView', // Central command ID
                 title: `Show ${childLabel}`, // Command title (used internally/tooltip)
                 arguments: commandArgs // Pass [content, title]
             }
        }];

        this._onDidChangeTreeData.fire();
    }


    public clearNodeContent(nodeId: string, description?: string) {
        const node = this.findRootNode(nodeId);
        if (node && node.isCategory) {
            const hadChildren = node.children.length > 0;
            node.children = [];
            node.description = description ?? "(cleared)"; // Set to provided description or default
            if (hadChildren) {
                 this._onDidChangeTreeData.fire();
            } else {
                 // If description changed, still need to fire event
                 this._onDidChangeTreeData.fire();
            }
        } else {
            console.warn(`Category node with id "${nodeId}" not found for clearing content.`);
        }
    }

    public clearAllNodes(resetDescription: string = "Awaiting debug process...") {
        let changed = false;
        this.rootItems.forEach(node => {
            if (node.children.length > 0) {
                 node.children = [];
                 changed = true;
            }
            if (node.description !== resetDescription) {
                node.description = resetDescription;
                changed = true;
            }
        });
        if (changed) {
             this._onDidChangeTreeData.fire();
        }
    }
}
