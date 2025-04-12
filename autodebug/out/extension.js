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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const debugViewProvider_1 = require("./debugViewProvider");
const targetPickerViewProvider_1 = require("./targetPickerViewProvider");
const backendInterface_1 = require("./backendInterface");
const markdown_it_1 = __importDefault(require("markdown-it"));
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
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Simulating Debug for ${target}...` }, async (progress, token) => {
            try {
                progress.report({ increment: 0 });
                // Initialize the node content
                autoDebugViewProvider.setNodeContent("trace", [], "Debugging");
                autoDebugViewProvider.setNodeContent("suggestions", [], "Waiting to finish debugging");
                // Buffers for the incoming streams
                const traceLines = [];
                let suggestionContent = "";
                // Track the current stream state
                let currentSection = 'trace';
                // Call the backend method to start debugging and get the stream
                const debugStream = backend.debugTarget(target, bugDescription);
                // Iterate over the async generator to process each DebugResponse
                for await (const result of debugStream) {
                    if (result.type === 'trace') {
                        traceLines.push(result.content);
                        autoDebugViewProvider.setNodeContent("trace", traceLines, `${traceLines.length} trace lines`);
                    }
                    else if (result.type === 'answer') {
                        // Once we hit 'answer', finish the cot section and display it in the webview
                        if (currentSection === 'trace') {
                            currentSection = 'answer'; // Switch to answer section
                            autoDebugViewProvider.setNodeContent("trace", [], "Finished tracing");
                            // Display trace in webview as markdown
                            const traceContent = traceLines.join('\n');
                            vscode.commands.executeCommand('autodebug.showContentWebView', traceContent, 'Trace');
                            progress.report({ increment: 50, message: "Trace complete!" });
                        }
                        suggestionContent += result.content;
                        autoDebugViewProvider.setNodeContent("suggestions", [], "Compiling suggestions");
                    }
                }
                // Final updates after the stream has finished
                autoDebugViewProvider.setNodeContent("suggestions", suggestionContent, "Ready");
                progress.report({ increment: 100, message: "Debugging complete!" });
            }
            catch (err) {
                vscode.window.showErrorMessage(`Debugging failed: ${err}`);
            }
        });
    });
    const showContentWebViewCommand = vscode.commands.registerCommand('autodebug.showContentWebView', (content, title) => {
        // Create and show a new webview panel
        const panel = vscode.window.createWebviewPanel('autodebugContent', // Identifies the type of the webview. Used internally
        title, // Title of the panel displayed to the user
        vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
        {
            // Enable javascript in the webview
            enableScripts: true,
            // Restrict the webview to only loading content from our extension's `media` directory.
            // localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] // Optional: If loading local resources
        });
        // Initialize markdown-it
        const md = new markdown_it_1.default({
            html: true, // Enable HTML tags in source
            linkify: true, // Autoconvert URL-like text to links
            typographer: true, // Enable some language-neutral replacement + quotes beautification
            breaks: true, // Convert '\n' in paragraphs into <br>
        });
        // Render the markdown content to HTML
        const htmlContent = md.render(content);
        // Set the webview's initial html content
        panel.webview.html = getWebviewContent(htmlContent, title);
        // Optional: Listen for messages from the webview
        panel.webview.onDidReceiveMessage(message => {
            // Handle messages from the webview if needed
            console.log("Received message:", message);
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(selectMakefileCommand, debugTargetCommand, showContentWebViewCommand);
}
function getWebviewContent(renderedMarkdown, title) {
    // Basic HTML structure with some default styling for readability
    // You can enhance this with more sophisticated CSS or a CSS framework
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            padding: 20px;
            font-family: var(--vscode-editor-font-family, 'Segoe WPC', 'Segoe UI', sans-serif);
            font-size: var(--vscode-editor-font-size);
            line-height: 1.6;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        h1, h2, h3, h4, h5, h6 {
             font-weight: bold;
             margin-top: 1.5em;
             margin-bottom: 0.5em;
        }
        code {
            font-family: var(--vscode-editor-font-family, Menlo, Monaco, 'Courier New', monospace);
            background-color: var(--vscode-textCodeBlock-background); /* Use VS Code's code block background */
            padding: 0.2em 0.4em;
            border-radius: 3px;
            font-size: 0.9em; /* Slightly smaller for inline code */
        }
        pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 1em;
            border-radius: 5px;
            overflow-x: auto; /* Add horizontal scroll for long lines */
            white-space: pre-wrap; /* Wrap long lines within the block */
            word-wrap: break-word; /* Break words if necessary */
        }
        pre code {
             padding: 0; /* Reset padding for code inside pre */
             background-color: transparent; /* Inherit background from pre */
             border-radius: 0;
             font-size: 1em; /* Reset font size for code blocks */
        }
        blockquote {
             border-left: 4px solid var(--vscode-textSeparator-foreground);
             padding-left: 1em;
             margin-left: 0;
             color: var(--vscode-textSeparator-foreground);
        }
        a {
             color: var(--vscode-textLink-foreground);
             text-decoration: none;
        }
        a:hover {
             text-decoration: underline;
        }
        ul, ol {
            padding-left: 2em;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin-bottom: 1em;
        }
        th, td {
            border: 1px solid var(--vscode-editorWidget-border, #ccc);
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: var(--vscode-editorGroupHeader-tabsBackground);
        }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <hr>
    ${renderedMarkdown}
</body>
</html>`;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map