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

        if (nodeId === 'trace') {
            // Handle trace lines as individual children
            if (!Array.isArray(content)) {
                console.warn(`Invalid content type for trace node in setNodeContent. Expected string[].`);
                node.children = [];
                node.description = description ?? "(Invalid content)";
                this._onDidChangeTreeData.fire();
                return;
            }
            node.children = content.map((line: string) => {
                const childId = `${nodeId}_content_${this.contentCounter++}`;
                return {
                    id: childId, label: line, content: line, children: [], isCategory: false, command: undefined
                };
            });
            node.description = description ?? (content.length > 0 ? `(${content.length} items)` : "(empty)");

        } else if (nodeId === 'suggestions') { // Simplified condition, only handles suggestions now
           // Handle Suggestions as single markdown string displayed via webview
            if (typeof content !== 'string') {
                console.warn(`Invalid content type for ${nodeId} node. Expected string.`);
                node.children = [];
                node.description = description ?? "(Invalid content)";
                this._onDidChangeTreeData.fire();
                return;
           }

            const childId = `${nodeId}_content_${this.contentCounter++}`;
            const fullMarkdown = content;
            // Specific labels/titles for suggestions
            const childLabel = "View Suggestions";
            const viewTitle = "Suggestions & Final Thoughts";

            node.children = [{
                 id: childId,
                 label: childLabel,
                 content: fullMarkdown,
                 children: [],
                 isCategory: false,
                 command: {
                     command: 'autodebug.showContentWebView',
                     title: `Show ${childLabel}`,
                     arguments: [fullMarkdown, viewTitle]
                 }
            }];
            node.description = description ?? (content ? "(Content available)" : "(empty)");

        } else {
            console.warn(`Unknown or unsupported nodeId for setNodeContent: ${nodeId}`);
            node.children = [];
            node.description = description ?? "(Unknown node type)";
        }

        this._onDidChangeTreeData.fire();
    }

    public appendNodeContentLine(nodeId: string, newTextLine: string, updateDescription: boolean = true) {
        if (nodeId === 'suggestions') {
            console.warn(`Appending lines directly is not standard for node '${nodeId}'. Use setNodeContent.`);
            return;
        }

       // Original logic for 'trace' - append as a new child
       const node = this.findRootNode(nodeId);
       if (node && node.isCategory && nodeId === 'trace') {
           const childId = `${nodeId}_content_${this.contentCounter++}`;
           node.children.push({
               id: childId,
               label: newTextLine,
               content: newTextLine,
               children: [],
               isCategory: false,
               command: undefined // Ensure appended trace lines have no command
           });
           if (updateDescription) {
               // Update description to reflect total items (lines + potential viewer button later)
               node.description = `(${node.children.length} items)`;
           }
           this._onDidChangeTreeData.fire();
       } else if (nodeId !== 'trace') {
             console.warn(`Cannot append to node '${nodeId}'.`);
       } else {
           console.warn(`Category node with id "${nodeId}" not found for appending content.`);
       }
    }

    public addFinalContentViewer(nodeId: string) {
        if (nodeId !== 'trace') {
             console.warn(`addFinalContentViewer called for non-trace node: ${nodeId}. Ignoring.`);
             return; // Only applicable to trace for now
        }

        const node = this.findRootNode(nodeId);
        if (!node || !node.isCategory) {
            console.warn(`Cannot add final viewer: Category node with id "${nodeId}" not found.`);
            return;
        }

        // Check if a viewer button already exists (prevent duplicates)
        const existingViewer = node.children.find(child => child.command?.command === 'autodebug.showContentWebView');
        if (existingViewer) {
            console.warn(`Final viewer button already exists for node: ${nodeId}.`);
            // Optionally update its content? For now, just return.
            return;
        }

        // Gather content from all existing children (which should be trace lines)
        const fullTraceContent = node.children
            .map(child => child.content || '') // Get content, default to empty string if missing
            .join('\n');

        if (!fullTraceContent && node.children.length === 0) {
            console.log(`No content found for node ${nodeId}, skipping final viewer.`);
            // Optionally add an "(empty)" viewer? Or just do nothing.
            return;
        }

        const childId = `${nodeId}_viewer_${this.contentCounter++}`;
        const childLabel = "View Full Trace";
        const viewTitle = "Full Debug Trace";

        // Create the viewer button data
        const viewerButton: DebugTreeItemData = {
            id: childId, label: childLabel, content: fullTraceContent, children: [], isCategory: false,
            icon: new vscode.ThemeIcon('go-to-file'),
            command: {
                command: 'autodebug.showContentWebView', title: `Show ${childLabel}`, arguments: [fullTraceContent, viewTitle]
            }
        };

        // Push the viewer button to the end of the children list
        node.children.push(viewerButton);

        // Update description if needed (e.g., indicate viewer is available)
        // node.description = `(${node.children.length -1} lines + Viewer)`; // Example description update

        this._onDidChangeTreeData.fire(); // Refresh the tree view
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
