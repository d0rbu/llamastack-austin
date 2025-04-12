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
    // private rootItems: DebugTreeItemData[] = [
    //     { label: "Full trace", content: "Trace details will appear here...", children: [] },
    //     { label: "Chain of thought", content: "LLM reasoning steps will appear here...", children: [] },
    //     { label: "Code suggestions etc final thoughts", content: "Suggestions and conclusions will appear here...", children: [] }
    // ];
    rootItems = [
        { id: "trace", label: "Full trace", description: "Awaiting debug process...", children: [], isCategory: true, icon: new vscode.ThemeIcon('list-unordered') },
        { id: "cot", label: "Chain of thought", description: "Awaiting debug process...", children: [], isCategory: true, icon: new vscode.ThemeIcon('comment-discussion') },
        { id: "suggestions", label: "Code suggestions etc final thoughts", description: "Awaiting debug process...", children: [], isCategory: true, icon: new vscode.ThemeIcon('issues') }
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
            }
            else {
                // For special single children (CoT, Suggestions) that have commands
                item.iconPath = item.iconPath || new vscode.ThemeIcon('go-to-file'); // Icon indicating action
                item.tooltip = "Click to view full content"; // More specific tooltip
            }
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
        if (element && element.id) {
            const parentData = this.findNodeById(element.id, this.rootItems);
            if (parentData) {
                // Type child explicitly
                return Promise.resolve(parentData.children.map((child) => this.dataToTreeItem(child)));
            }
        }
        else {
            // Type item explicitly
            return Promise.resolve(this.rootItems.map((item) => this.dataToTreeItem(item)));
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
        let childLabel = "View Content"; // Default label
        let fullContentString;
        let commandArgs; // [content, title]
        if (nodeId === 'trace') {
            if (Array.isArray(content)) {
                fullContentString = content.join('\n');
                childLabel = "View Full Trace";
                node.description = description ?? (content.length > 0 ? `(${content.length} lines)` : "(empty)");
            }
            else if (typeof content === 'string') {
                // Allow setting trace from a single string too
                fullContentString = content;
                childLabel = "View Full Trace";
                node.description = description ?? (content ? "(Content available)" : "(empty)");
            }
            else {
                console.warn(`Invalid content type for trace node. Expected string[] or string.`);
                node.children = [];
                node.description = description ?? "(Invalid content)";
                this._onDidChangeTreeData.fire();
                return;
            }
            commandArgs = [fullContentString, "Full Debug Trace"];
        }
        else if (nodeId === 'cot') {
            if (typeof content === 'string') {
                fullContentString = content;
                childLabel = "View Chain of Thought";
                node.description = description ?? (content ? "(Content available)" : "(empty)");
                commandArgs = [fullContentString, "Chain of Thought"];
            }
            else {
                console.warn(`Invalid content type for cot node. Expected string.`);
                node.children = [];
                node.description = description ?? "(Invalid content)";
                this._onDidChangeTreeData.fire();
                return;
            }
        }
        else if (nodeId === 'suggestions') {
            if (typeof content === 'string') {
                fullContentString = content;
                childLabel = "View Suggestions";
                node.description = description ?? (content ? "(Content available)" : "(empty)");
                commandArgs = [fullContentString, "Suggestions & Final Thoughts"];
            }
            else {
                console.warn(`Invalid content type for suggestions node. Expected string.`);
                node.children = [];
                node.description = description ?? "(Invalid content)";
                this._onDidChangeTreeData.fire();
                return;
            }
        }
        else {
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
    clearNodeContent(nodeId, description) {
        const node = this.findRootNode(nodeId);
        if (node && node.isCategory) {
            const hadChildren = node.children.length > 0;
            node.children = [];
            node.description = description ?? "(cleared)"; // Set to provided description or default
            if (hadChildren) {
                this._onDidChangeTreeData.fire();
            }
            else {
                // If description changed, still need to fire event
                this._onDidChangeTreeData.fire();
            }
        }
        else {
            console.warn(`Category node with id "${nodeId}" not found for clearing content.`);
        }
    }
    clearAllNodes(resetDescription = "Awaiting debug process...") {
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
exports.AutoDebugViewProvider = AutoDebugViewProvider;
//# sourceMappingURL=debugViewProvider.js.map