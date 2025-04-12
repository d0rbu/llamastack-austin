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
        item.tooltip = data.content || data.label; // Tooltip can still show full content if needed
        item.iconPath = data.icon;
        item.description = data.description;
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
            const MAX_LABEL_LENGTH = 150;
            if (item.label && typeof item.label === 'string' && item.label.length > MAX_LABEL_LENGTH) {
                item.label = item.label.substring(0, MAX_LABEL_LENGTH) + "...";
            }
            item.iconPath = item.iconPath || new vscode.ThemeIcon('debug-console');
            // Content lines generally shouldn't have descriptions
            item.description = undefined;
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
            // If an element is passed, find its data and return its children mapped to TreeItems
            const parentData = this.findNodeById(element.id, this.rootItems);
            if (parentData) {
                return Promise.resolve(parentData.children.map(child => this.dataToTreeItem(child)));
            }
        }
        else {
            // If no element is passed, return the root items
            return Promise.resolve(this.rootItems.map(item => this.dataToTreeItem(item)));
        }
        return Promise.resolve([]); // Should not happen in practice
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
    setNodeContent(nodeId, newContentLines, description) {
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
            }
            else {
                // Default description update based on content, or clear it
                node.description = newContentLines.length > 0 ? `(${newContentLines.length} items)` : "(empty)";
            }
            this._onDidChangeTreeData.fire();
        }
        else {
            console.warn(`Category node with id "${nodeId}" not found for setting content.`);
        }
    }
    appendNodeContentLine(nodeId, newTextLine, updateDescription = true) {
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
        }
        else {
            console.warn(`Category node with id "${nodeId}" not found for appending content.`);
        }
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