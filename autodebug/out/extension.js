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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const debugViewProvider_1 = require("./debugViewProvider");
const targetPickerViewProvider_1 = require("./targetPickerViewProvider");
const backendInterface_1 = require("./backendInterface");
function activate(context) {
    const autoDebugViewProvider = new debugViewProvider_1.AutoDebugViewProvider(context);
    vscode.window.registerTreeDataProvider('autodebugView', autoDebugViewProvider);
    vscode.window.createTreeView('autodebugView', {
        treeDataProvider: autoDebugViewProvider,
    });
    const targetPickerProvider = new targetPickerViewProvider_1.TargetPickerViewProvider(context);
    vscode.window.registerTreeDataProvider('targetPickerView', targetPickerProvider);
    vscode.window.createTreeView('targetPickerView', {
        treeDataProvider: targetPickerProvider,
    });
    const selectMakefileCommand = vscode.commands.registerCommand('autodebug.selectMakefile', async () => {
        const uri = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Select Makefile'
        });
        if (uri && uri[0]) {
            await targetPickerProvider.loadTargets(uri[0].fsPath);
        }
    });
    const debugTargetCommand = vscode.commands.registerCommand('autodebug.debugTarget', async (target) => {
        const backend = new backendInterface_1.BackendInterface(context);
        const bugDescription = await vscode.window.showInputBox({
            prompt: 'Describe the bug or unexpected behavior you are encountering.',
            placeHolder: 'e.g., segfault when input is empty'
        });
        if (!bugDescription) {
            vscode.window.showWarningMessage('Debugging canceled: no bug description provided.');
            return;
        }
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Debugging ${target}...` }, async (progress, token) => {
            try {
                progress.report({ increment: 0 });
                // Initialize the node content
                autoDebugViewProvider.setNodeContent("trace", [], "Debugging");
                autoDebugViewProvider.setNodeContent("cot", [], "Waiting to finish debugging");
                autoDebugViewProvider.setNodeContent("suggestions", [], "Waiting to finish debugging");
                // Buffers for the incoming streams
                const traceLines = [];
                const cotLines = [];
                const suggestionLines = [];
                // Call the backend method to start debugging and get the stream
                const debugStream = backend.debugTarget(target, bugDescription);
                // Iterate over the async generator to process each DebugResponse
                for await (const result of debugStream) {
                    if (result.type === 'trace') {
                        traceLines.push(result.content);
                        autoDebugViewProvider.setNodeContent("trace", traceLines, `${traceLines.length} trace lines`);
                    }
                    else if (result.type === 'cot') {
                        cotLines.push(result.content);
                        autoDebugViewProvider.setNodeContent("cot", cotLines, `${cotLines.length} reasoning steps`);
                    }
                    else if (result.type === 'answer') {
                        suggestionLines.push(result.content);
                        autoDebugViewProvider.setNodeContent("suggestions", suggestionLines, "Compiling suggestions");
                    }
                }
                // Final updates after the stream has finished
                autoDebugViewProvider.setNodeContent("suggestions", suggestionLines, "Ready");
                progress.report({ increment: 100, message: "Debugging complete!" });
            }
            catch (err) {
                vscode.window.showErrorMessage(`Debugging failed: ${err}`);
            }
        });
    });
    context.subscriptions.push(selectMakefileCommand, debugTargetCommand);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map