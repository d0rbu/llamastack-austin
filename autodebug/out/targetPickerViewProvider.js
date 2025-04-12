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
            return item;
        });
        const selectMakefileItem = new vscode.TreeItem("Select Makefile", vscode.TreeItemCollapsibleState.None);
        selectMakefileItem.command = {
            command: 'autodebug.selectMakefile',
            title: 'Select Makefile'
        };
        selectMakefileItem.tooltip = "Choose a Makefile to analyze build targets";
        selectMakefileItem.iconPath = new vscode.ThemeIcon('file');
        return Promise.resolve([...items, selectMakefileItem]);
    }
    async loadTargets(makefilePath) {
        const targetList = await this.backend.fetchBuildTargets(makefilePath);
        this.targets = targetList;
        this._onDidChangeTreeData.fire();
    }
}
exports.TargetPickerViewProvider = TargetPickerViewProvider;
function createSimpleTreeItem(label) {
    return new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
}
//# sourceMappingURL=targetPickerViewProvider.js.map