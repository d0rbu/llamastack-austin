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
    // private rootItems: DebugTreeItemData[] = [
    //     { label: "Full trace", content: "Trace details will appear here...", children: [] },
    //     { label: "Chain of thought", content: "LLM reasoning steps will appear here...", children: [] },
    //     { label: "Code suggestions etc final thoughts", content: "Suggestions and conclusions will appear here...", children: [] }
    // ];
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
        // switch (data.label) {
        //     case "Full trace":
        //         item.iconPath = new vscode.ThemeIcon('list-unordered'); // Or 'checklist', 'references'
        //         break;
        //     case "Chain of thought":
        //         item.iconPath = new vscode.ThemeIcon('comment-discussion'); // Or 'hubot', 'lightbulb'
        //         break;
        //     case "Code suggestions etc final thoughts":
        //         item.iconPath = new vscode.ThemeIcon('issues'); // Or 'lightbulb-autofix', 'beaker'
        //         break;
        //     default:
        //         // Optional: default icon
        //         item.iconPath = new vscode.ThemeIcon('circle-outline');
        // }
        // return item;
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

        if (nodeId === 'trace' && Array.isArray(content)) {
             // Handle trace lines as before
             node.children = content.map((line: string) => {
                 const childId = `${nodeId}_content_${this.contentCounter++}`;
                 return {
                     id: childId, label: line, content: line, children: [], isCategory: false,
                 };
             });
             node.description = description ?? (content.length > 0 ? `(${content.length} items)` : "(empty)");

        } else if ((nodeId === 'cot' || nodeId === 'suggestions') && typeof content === 'string') {
            // Handle CoT and Suggestions as single markdown string
            const childId = `${nodeId}_content_${this.contentCounter++}`;
            const fullMarkdown = content;
            let childLabel = "View Content"; // Default label
             if (nodeId === 'cot') childLabel = "View Chain of Thought";
             if (nodeId === 'suggestions') childLabel = "View Suggestions";

            node.children = [{
                 id: childId,
                 label: childLabel, // Specific label
                 content: fullMarkdown, // Store the FULL markdown here
                 children: [],
                 isCategory: false,
                 // Define the command to be executed when this item is clicked
                 command: {
                     command: 'autodebug.showMarkdownContent', // Command ID registered in extension.ts
                     title: 'Show Content', // Command title (used internally/tooltip)
                     arguments: [fullMarkdown] // Pass the full markdown as argument
                 }
            }];
            // Update description (maybe just indicate content is loaded)
            node.description = description ?? "(Content available)";

        } else {
             console.warn(`Invalid content type or nodeId for setNodeContent. NodeId: ${nodeId}, Content type: ${typeof content}`);
             // Fallback: Clear children and set description
             node.children = [];
             node.description = description ?? "(Invalid content)";
        }

        this._onDidChangeTreeData.fire();
    }

    public appendNodeContentLine(nodeId: string, newTextLine: string, updateDescription: boolean = true) {
        if (nodeId === 'cot' || nodeId === 'suggestions') {
            console.warn(`Appending lines directly is not standard for node '${nodeId}'. Use setNodeContent.`);
            // Optional: Implement appending to the single child's content if needed for streaming
            const node = this.findRootNode(nodeId);
            if (node && node.children.length === 1) {
                node.children[0].content += "\n" + newTextLine;
                // Re-assign command arguments if needed? Might be complex.
                // Firing change event on the parent is usually enough.
                this._onDidChangeTreeData.fire();
            }
            return;
        }

       // Original logic for 'trace'
       const node = this.findRootNode(nodeId);
       if (node && node.isCategory) {
           // ... (rest of the original append logic for trace) ...
           const childId = `${nodeId}_content_${this.contentCounter++}`;
           node.children.push({
               id: childId,
               label: newTextLine,
               content: newTextLine,
               children: [],
               isCategory: false,
           });
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
