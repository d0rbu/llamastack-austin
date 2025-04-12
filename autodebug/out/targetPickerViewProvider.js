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
exports.TargetPickerViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const backendInterface_1 = require("./backendInterface");
class TargetPickerViewProvider {
    context;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    targets = [];
    backend;
    constructor(context) {
        this.context = context;
        this.backend = new backendInterface_1.BackendInterface(context);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        const items = this.targets.map(t => {
            const item = new vscode.TreeItem(t, vscode.TreeItemCollapsibleState.None);
            item.command = {
                command: 'autodebug.debugTarget',
                title: 'Debug Target',
                arguments: [t]
            };
            item.tooltip = `Run debug target: ${t}`;
            item.iconPath = new vscode.ThemeIcon('debug-start');
            return item;
        });
        return Promise.resolve(items);
    }
    async loadTargets(makefilePath) {
        try {
            const targetList = await this.backend.fetchBuildTargets(makefilePath);
            if (targetList && targetList.length > 0) {
                this.targets = targetList;
            }
            else {
                this.targets = ["No build targets found in selected Makefile."];
            }
            this._onDidChangeTreeData.fire();
        }
        catch (error) {
            console.error("Error fetching build targets:", error);
            this.targets = ["Error fetching targets."];
            vscode.window.showErrorMessage(`Error fetching targets: ${error}`);
            this._onDidChangeTreeData.fire();
        }
    }
    // Add a method to clear targets, maybe called before loading new ones
    clearTargets() {
        this.targets = ["Click 'Select Makefile' button above..."];
        this._onDidChangeTreeData.fire();
    }
}
exports.TargetPickerViewProvider = TargetPickerViewProvider;
function createSimpleTreeItem(label) {
    return new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
}
//# sourceMappingURL=targetPickerViewProvider.js.map