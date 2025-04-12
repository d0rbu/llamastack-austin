// Define the structure for our tree items
interface DebugTreeItemData {
    id: string; // Unique ID for the item
    label: string; // Display label
    description?: string; // Optional: Text shown next to the label
    content?: string; // Optional: Raw content, maybe for tooltip or full view later
    children: DebugTreeItemData[]; // Children nodes
    isCategory: boolean; // Flag to distinguish category nodes from content lines
    icon?: vscode.ThemeIcon; // Optional specific icon
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
        item.tooltip = data.content || data.label; // Tooltip can still show full content if needed
        item.iconPath = data.icon;
        item.description = data.description;
        if (!data.isCategory) {
            const MAX_LABEL_LENGTH = 150;
            if (item.label && typeof item.label === 'string' && item.label.length > MAX_LABEL_LENGTH) {
                item.label = item.label.substring(0, MAX_LABEL_LENGTH) + "...";
            }
            // item.iconPath = item.iconPath || new vscode.ThemeIcon('dash');
            // Content lines generally shouldn't have descriptions
            item.description = undefined;
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
            // If an element is passed, find its data and return its children mapped to TreeItems
            const parentData = this.findNodeById(element.id, this.rootItems);
            if (parentData) {
                return Promise.resolve(parentData.children.map(child => this.dataToTreeItem(child)));
            }
        } else {
            // If no element is passed, return the root items
            return Promise.resolve(this.rootItems.map(item => this.dataToTreeItem(item)));
        }
        return Promise.resolve([]); // Should not happen in practice
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

    public setNodeContent(nodeId: string, newContentLines: string[], description?: string) {
        const node = this.findRootNode(nodeId);
        if (node && node.isCategory) {
            node.children = newContentLines.map(line => {
                const childId = `${nodeId}_content_${this.contentCounter++}`;
                return {
                    id: childId,
                    label: line,
                    content: line, // Store full line content if needed
                    children: [],
                    isCategory: false,
                };
            });
             // Update description if provided
             if (description !== undefined) {
                 node.description = description;
             } else {
                 // Default description update based on content, or clear it
                 node.description = newContentLines.length > 0 ? `(${newContentLines.length} items)` : "(empty)";
             }

            this._onDidChangeTreeData.fire();
        } else {
            console.warn(`Category node with id "${nodeId}" not found for setting content.`);
        }
    }

    public appendNodeContentLine(nodeId: string, newTextLine: string, updateDescription: boolean = true) {
        const node = this.findRootNode(nodeId);
        if (node && node.isCategory) {
            const childId = `${nodeId}_content_${this.contentCounter++}`;
            node.children.push({
                id: childId,
                label: newTextLine,
                content: newTextLine,
                children: [],
                isCategory: false,
            });

            // Optionally update the description to reflect the new count
            if (updateDescription) {
                node.description = `(${node.children.length} items)`;
            }

            this._onDidChangeTreeData.fire();
        } else {
            console.warn(`Category node with id "${nodeId}" not found for appending content.`);
        }
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
