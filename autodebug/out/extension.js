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
    // const debugTargetCommand = vscode.commands.registerCommand('autodebug.debugTarget', async (target: string) => {
    //     const backend = new BackendInterface(context);
    //     vscode.window.withProgress(
    //         { location: vscode.ProgressLocation.Notification, title: `Debugging ${target}...` },
    //         async (progress, token) => {
    //             try {
    // 				progress.report({ increment: 0 });
    //                 autoDebugViewProvider.clearAllNodes("Debugging in progress...");
    //                 // Set initial descriptions indicating process start
    //                 autoDebugViewProvider.updateNodeDescription("trace", "Running debug...");
    //                 autoDebugViewProvider.updateNodeDescription("suggestions", "Running debug...");
    //                 const result = await backend.debugTarget(target) as DebugResponse;
    //                 // Process results
    // 				const traceContent = result.trace || ""; // Default to empty string
    //                 const suggestionContent = result.answer || "No suggestions received.";
    //                 // Split trace into lines for individual tree items
    //                 const traceLines = traceContent ? traceContent.split('\n') : []; // Handle empty trace
    //                 // Set the individual trace lines first
    //                 autoDebugViewProvider.setNodeContent(
    //                     "trace",
    //                     traceLines,
    //                     traceLines.length > 0 ? `(${traceLines.length} lines)` : "(empty)"
    //                 );
    //                 // Now, add the final viewer button for the trace
    //                 if (traceLines.length > 0) {
    //                     autoDebugViewProvider.addFinalContentViewer("trace");
    //                      // Optionally update description again after adding viewer
    //                      autoDebugViewProvider.updateNodeDescription("trace", `(${traceLines.length} lines + Viewer)`);
    //                 }
    //                 // Set the Suggestions content (creates its viewer directly)
    //                 autoDebugViewProvider.setNodeContent(
    //                     "suggestions",
    //                     suggestionContent,
    //                     suggestionContent ? "Content available" : "(empty)"
    //                 );
    //                 progress.report({ increment: 100, message: "Debugging complete!" });
    //             } catch (err) {
    //                 vscode.window.showErrorMessage(`Debugging failed: ${err}`);
    //             }
    //         }
    //     );
    // });
    const debugTargetCommand = vscode.commands.registerCommand('autodebug.debugTarget', async (target) => {
        // --- Start Test Simulation ---
        // Temporarily bypass the actual backend call for testing
        // const backend = new BackendInterface(context);
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Simulating Debug for ${target}...` }, async (progress, token) => {
            try {
                progress.report({ increment: 0, message: "Starting simulation..." });
                autoDebugViewProvider.clearAllNodes("Simulation in progress...");
                // Set initial descriptions
                autoDebugViewProvider.updateNodeDescription("trace", "Simulating trace...");
                autoDebugViewProvider.updateNodeDescription("suggestions", "Awaiting simulation...");
                // 1. Simulate streaming trace lines
                const simulatedTraceLines = [
                    "Starting process...",
                    "Reading config file `/etc/app.conf`...",
                    "Connecting to database `main_db`...",
                    "Executing query `SELECT * FROM users WHERE id = 123;`...",
                    "Processing results (found 1 record)...",
                    "Error: Network timeout on service `auth_service`.",
                    "Retrying connection...",
                    "Failed to connect after 3 retries.",
                    "Exiting process with error code 5."
                ];
                // Clear existing trace content before starting append simulation
                autoDebugViewProvider.clearNodeContent("trace", "Simulating lines...");
                await new Promise(resolve => setTimeout(resolve, 500)); // Short delay
                for (let i = 0; i < simulatedTraceLines.length; i++) {
                    if (token.isCancellationRequested) {
                        vscode.window.showInformationMessage("Simulation cancelled.");
                        autoDebugViewProvider.clearAllNodes("Simulation cancelled.");
                        return;
                    }
                    const line = simulatedTraceLines[i];
                    autoDebugViewProvider.appendNodeContentLine("trace", line);
                    progress.report({ increment: (1 / (simulatedTraceLines.length + 2)) * 100, message: `Trace line ${i + 1}` }); // Adjust progress incrementally
                    await new Promise(resolve => setTimeout(resolve, 300)); // Simulate delay between lines
                }
                // 2. Add the final trace viewer
                autoDebugViewProvider.addFinalContentViewer("trace");
                autoDebugViewProvider.updateNodeDescription("trace", `(${simulatedTraceLines.length} lines + Viewer)`);
                progress.report({ increment: (1 / (simulatedTraceLines.length + 2)) * 100, message: "Trace viewer added." });
                await new Promise(resolve => setTimeout(resolve, 500)); // Delay before showing suggestions
                // 3. Simulate suggestions content
                const simulatedSuggestions = `## Analysis

The trace indicates a **network timeout** when trying to reach the \`auth_service\`. This happened after successfully connecting to the database and processing a query.

**Possible Causes:**

*   **Network Issue:** Firewall blocking the connection, DNS resolution failure, or general network instability between the application server and the auth service.
*   **Auth Service Down:** The \`auth_service\` itself might be unavailable or overloaded.
*   **Incorrect Configuration:** The application might have an incorrect address or port configured for the \`auth_service\`.

**Recommendations:**

1.  **Check Network Connectivity:** Verify network path and firewall rules between the application host and the \`auth_service\` host. Use tools like \`ping\` or \`traceroute\`.
2.  **Verify Auth Service Status:** Check if the \`auth_service\` is running and responsive. Look at its logs for any errors.
3.  **Review Configuration:** Double-check the configuration files (\`e.g., /etc/app.conf\`) for the correct address/hostname and port for \`auth_service\`.
4.  **Implement Retry Logic (with backoff):** While retries were attempted, consider implementing exponential backoff to avoid overwhelming the service if it's temporarily overloaded.

\`\`\`typescript
// Example retry logic
async function connectWithRetry(attempt = 1) {
  const MAX_RETRIES = 5;
  const INITIAL_DELAY = 500; // ms
  try {
    await connectToAuthService();
    console.log("Connected successfully!");
  } catch (error) {
    if (attempt <= MAX_RETRIES) {
      const delay = INITIAL_DELAY * Math.pow(2, attempt - 1);
      console.warn(\`Connection attempt \${attempt} failed. Retrying in \${delay}ms...\`);
      await new Promise(resolve => setTimeout(resolve, delay));
      await connectWithRetry(attempt + 1);
    } else {
      console.error("Max retries reached. Could not connect.");
      throw error; // Re-throw final error
    }
  }
}
\`\`\`
`;
                autoDebugViewProvider.setNodeContent("suggestions", simulatedSuggestions, "Suggestions ready");
                progress.report({ increment: (1 / (simulatedTraceLines.length + 2)) * 100, message: "Suggestions ready." });
                progress.report({ increment: 100, message: "Simulation complete!" });
            }
            catch (err) { // Added type annotation
                vscode.window.showErrorMessage(`Simulation failed: ${err?.message || err}`);
                autoDebugViewProvider.clearAllNodes("Simulation failed.");
            }
        });
        // --- End Test Simulation ---
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