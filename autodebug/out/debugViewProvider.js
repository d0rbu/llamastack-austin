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
    // Store the messages or data to display
    viewContent = "Waiting for debugging process to start...";
    constructor(context) {
        this.context = context;
    }
    // Required method: Get the tree item representation
    getTreeItem(element) {
        return element;
    }
    // Required method: Get the children of an element or the root elements
    getChildren(element) {
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
    updateView(content) {
        this.viewContent = content;
        this._onDidChangeTreeData.fire(); // Signal VS Code that the view data has changed
    }
    // Method to append content (useful for streaming)
    appendContent(newText) {
        this.viewContent += newText;
        this._onDidChangeTreeData.fire();
    }
    // Method to clear the content
    clearView() {
        this.viewContent = "";
        this._onDidChangeTreeData.fire();
    }
}
exports.AutoDebugViewProvider = AutoDebugViewProvider;
// Helper function to create a simple TreeItem
function createSimpleTreeItem(label) {
    return new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
}
//# sourceMappingURL=debugViewProvider.js.map