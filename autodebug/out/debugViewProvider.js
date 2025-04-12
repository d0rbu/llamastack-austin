"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoDebugViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class AutoDebugViewProvider {
    context;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    // Store the root items for the tree view
    rootItems = [
        { id: "trace", label: "Full trace", description: "Awaiting debug process...", children: [], isCategory: true, icon: new vscode.ThemeIcon('list-unordered') },
        { id: "suggestions", label: "Suggestions", description: "Awaiting debug process...", children: [], isCategory: true, icon: new vscode.ThemeIcon('issues') }
    ];
    contentCounter = 0;
    constructor(context) {
        this.context = context;
    }
    // Map our data structure to VS Code TreeItem
    dataToTreeItem(data) {
        const collapsibleState = (data.children && data.children.length > 0)
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None; // Make it collapsible only if it has children (for future)
        const item = new vscode.TreeItem(data.label, collapsibleState);
        item.id = data.id;
        item.tooltip = data.content || data.label;
        item.iconPath = data.icon;
        item.description = data.description;
        item.command = data.command;
        if (!data.isCategory && !data.command) {
            const MAX_LABEL_LENGTH = 150;
            if (item.label && typeof item.label === 'string' && item.label.length > MAX_LABEL_LENGTH) {
                item.label = item.label.substring(0, MAX_LABEL_LENGTH) + "...";
            }
            item.iconPath = item.iconPath || new vscode.ThemeIcon('dash');
            item.description = undefined; // Trace lines don't need descriptions here
            item.tooltip = data.content || data.label; // Use line content for trace line tooltip
        }
        return item;
    }
    findNodeById(id, nodes) {
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
    getTreeItem(element) {
        // The element itself is the TreeItem
        return element;
    }
    getChildren(element) {
        if (element?.id) {
            // If getting children for suggestions, return empty as it acts as a button
            if (element.id === 'suggestions') {
                return Promise.resolve([]);
            }
            const parentData = this.findNodeById(element.id, this.rootItems);
            if (parentData) {
                return Promise.resolve(parentData.children.map(child => this.dataToTreeItem(child)));
            }
        }
        else {
            // Return root items
            return Promise.resolve(this.rootItems.map(item => this.dataToTreeItem(item)));
        }
        return Promise.resolve([]);
    }
    // --- Methods to update specific sections ---
    findRootNode(nodeId) {
        return this.rootItems.find(item => item.id === nodeId);
    }
    updateNodeDescription(nodeId, newDescription) {
        const node = this.findRootNode(nodeId);
        if (node && node.isCategory) {
            node.description = newDescription;
            this._onDidChangeTreeData.fire(); // Refresh needed to show description change
        }
        else {
            console.warn(`Category node with id "${nodeId}" not found for updating description.`);
        }
    }
    setNodeContent(nodeId, content, description) {
        const node = this.findRootNode(nodeId);
        if (!node || !node.isCategory) {
            console.warn(`Category node with id "${nodeId}" not found for setting content.`);
            return;
        }
        let needsRefresh = false;
        if (nodeId === 'trace') {
            // Handle trace lines as individual children
            if (!Array.isArray(content)) {
                console.warn(`Invalid content type for trace node in setNodeContent. Expected string[].`);
                node.children = [];
                node.description = description ?? "(Invalid content)";
                needsRefresh = true;
            }
            else {
                if (content.slice(-1)[0] == "SHOW_TRACE_BUTTON") {
                    // instead of showing the trace lines as children, make it a command to show the full trace in a webview
                    const fullTraceContent = content.slice(0, -1).join('\n'); // Join all but the last line for the full content
                    const viewTitle = "Trace";
                    const newCommand = {
                        command: 'autodebug.showContentWebView',
                        title: 'Trace', // Tooltip for the command itself
                        arguments: [fullTraceContent, viewTitle] // Join all but the last line for the content
                    };
                    const newDescription = description ?? (content ? "(Click to view)" : "(empty)");
                    // Check if update is actually needed
                    if (node.fullContent !== fullTraceContent || node.description !== newDescription || JSON.stringify(node.command) !== JSON.stringify(newCommand)) {
                        node.fullContent = fullTraceContent; // Store full content
                        node.command = newCommand; // Assign command directly to the root item
                        node.children = []; // Ensure no children
                        node.description = newDescription;
                        needsRefresh = true;
                    }
                }
                else {
                    const previousChildCount = node.children.length;
                    node.children = content.map((line) => {
                        const childId = `${nodeId}_content_${this.contentCounter++}`;
                        return {
                            id: childId, label: line, content: line, children: [], isCategory: false, command: undefined
                        };
                    });
                    node.description = description ?? (content.length > 0 ? `(${content.length} items)` : "(empty)");
                    // Refresh if children changed or description changed
                    needsRefresh = node.children.length !== previousChildCount || node.description !== description;
                    // Important: Remove any final viewer button added previously if we're resetting content
                    this.removeFinalContentViewer(nodeId); // Add helper or inline logic
                }
            }
        }
        else if (nodeId === 'suggestions') {
            // Handle Suggestions: Modify the root item itself to be clickable
            if (typeof content !== 'string') {
                console.warn(`Invalid content type for ${nodeId} node. Expected string.`);
                // Clear previous state if invalid content received
                node.fullContent = undefined;
                node.command = undefined;
                node.children = []; // Ensure no children
                node.description = description ?? "(Invalid content)";
                needsRefresh = true;
            }
            else {
                const viewTitle = "Suggestions & Final Thoughts";
                const newCommand = {
                    command: 'autodebug.showContentWebView',
                    title: 'Show Suggestions & Final Thoughts', // Tooltip for the command itself
                    arguments: [content, viewTitle]
                };
                const newDescription = description ?? (content ? "(Click to view)" : "(empty)");
                // Check if update is actually needed
                if (node.fullContent !== content || node.description !== newDescription || JSON.stringify(node.command) !== JSON.stringify(newCommand)) {
                    node.fullContent = content; // Store full content
                    node.command = newCommand; // Assign command directly to the root item
                    node.children = []; // Ensure no children
                    node.description = newDescription;
                    needsRefresh = true;
                }
            }
        }
        else {
            console.warn(`Unknown or unsupported nodeId for setNodeContent: ${nodeId}`);
            node.children = [];
            node.description = description ?? "(Unknown node type)";
            needsRefresh = true; // Assume refresh needed if unknown
        }
        if (needsRefresh) {
            this._onDidChangeTreeData.fire();
        }
    }
    removeFinalContentViewer(nodeId) {
        if (nodeId !== 'trace')
            return;
        const node = this.findRootNode(nodeId);
        if (node) {
            const viewerIndex = node.children.findIndex(child => child.command?.command === 'autodebug.showContentWebView');
            if (viewerIndex > -1) {
                node.children.splice(viewerIndex, 1);
                // Don't necessarily fire here, let the caller handle it.
            }
        }
    }
    appendNodeContentLine(nodeId, newTextLine, updateDescription = true) {
        if (nodeId !== 'trace') {
            console.warn(`Appending lines directly is not supported for node '${nodeId}'. Use setNodeContent.`);
            return;
        }
        const node = this.findRootNode(nodeId);
        if (node && node.isCategory) {
            // Ensure we don't add lines *after* the viewer button if it exists
            const viewerIndex = node.children.findIndex(child => child.command?.command === 'autodebug.showContentWebView');
            const childId = `${nodeId}_content_${this.contentCounter++}`;
            const newItem = {
                id: childId, label: newTextLine, content: newTextLine, children: [], isCategory: false, command: undefined
            };
            if (viewerIndex > -1) {
                // Insert before the viewer button
                node.children.splice(viewerIndex, 0, newItem);
            }
            else {
                // Append to the end if no viewer button yet
                node.children.push(newItem);
            }
            if (updateDescription) {
                const lineCount = node.children.filter(c => !c.command).length; // Count only lines
                const hasViewer = viewerIndex > -1;
                node.description = `(${lineCount} lines${hasViewer ? ' + Viewer' : ''})`;
            }
            this._onDidChangeTreeData.fire();
        }
        else {
            console.warn(`Category node with id "${nodeId}" not found for appending content.`);
        }
    }
    addFinalContentViewer(nodeId) {
        if (nodeId !== 'trace') {
            console.warn(`addFinalContentViewer called for non-trace node: ${nodeId}. Ignoring.`);
            return;
        }
        const node = this.findRootNode(nodeId);
        if (!node || !node.isCategory) { /* ... error ... */
            return;
        }
        const existingViewer = node.children.find(child => child.command?.command === 'autodebug.showContentWebView');
        if (existingViewer) { /* ... warn ... */
            return;
        }
        const fullTraceContent = node.children
            .filter(child => !child.command) // Only join content from lines
            .map(child => child.content || '')
            .join('\n');
        if (!fullTraceContent && node.children.filter(c => !c.command).length === 0) { /* ... skip ... */
            return;
        }
        const childId = `${nodeId}_viewer_${this.contentCounter++}`;
        const childLabel = "View Full Trace";
        const viewTitle = "Full Debug Trace";
        const viewerButton = {
            id: childId, label: childLabel, content: fullTraceContent, children: [], isCategory: false,
            icon: new vscode.ThemeIcon('go-to-file'),
            command: {
                command: 'autodebug.showContentWebView', title: `Show ${childLabel}`, arguments: [fullTraceContent, viewTitle]
            }
        };
        node.children.push(viewerButton);
        this._onDidChangeTreeData.fire();
    }
    clearNodeContent(nodeId, description) {
        const node = this.findRootNode(nodeId);
        if (!node || !node.isCategory) {
            console.warn(`Category node with id "${nodeId}" not found for clearing content.`);
            return;
        }
        let changed = false;
        const defaultDesc = "(cleared)";
        if (node.children.length > 0) {
            node.children = [];
            changed = true;
        }
        // Specifically clear command and content for suggestions when cleared
        if (nodeId === 'suggestions') {
            if (node.command) {
                node.command = undefined;
                changed = true;
            }
            if (node.fullContent) {
                node.fullContent = undefined;
                changed = true;
            }
        }
        const finalDescription = description ?? defaultDesc;
        if (node.description !== finalDescription) {
            node.description = finalDescription;
            changed = true;
        }
        if (changed) {
            this._onDidChangeTreeData.fire();
        }
    }
    clearAllNodes(resetDescription = "Awaiting debug process...") {
        let changed = false;
        this.rootItems.forEach(node => {
            let nodeChanged = false;
            if (node.children.length > 0) {
                node.children = [];
                nodeChanged = true;
            }
            // Clear command/content for suggestions specifically
            if (node.id === 'suggestions') {
                if (node.command) {
                    node.command = undefined;
                    nodeChanged = true;
                }
                if (node.fullContent) {
                    node.fullContent = undefined;
                    nodeChanged = true;
                }
            }
            if (node.description !== resetDescription) {
                node.description = resetDescription;
                nodeChanged = true;
            }
            if (nodeChanged)
                changed = true;
        });
        if (changed) {
            this._onDidChangeTreeData.fire();
        }
    }
}
exports.AutoDebugViewProvider = AutoDebugViewProvider;
//# sourceMappingURL=debugViewProvider.js.map