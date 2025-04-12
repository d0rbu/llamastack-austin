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
const ansi_to_html_1 = __importDefault(require("ansi-to-html"));
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
    const channel = vscode.window.createOutputChannel("GDBuddy Trace");
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
                let lineBuffer = ""; // Buffer for latest line
                // Iterate over the async generator to process each DebugResponse
                for await (const result of debugStream) {
                    if (result.type === 'trace') {
                        traceLines.push(result.content);
                        autoDebugViewProvider.setNodeContent("trace", traceLines, `${traceLines.length} trace lines`);
                        const lines = result.content.split('\n');
                        for (let i = 0; i < lines.length; i++) {
                            const isLastLine = i === lines.length - 1;
                            lineBuffer += lines[i];
                            if (!isLastLine) {
                                channel.appendLine(lineBuffer + '\n'); // Append the current line to the buffer
                                // channel.show(true); // Show the output channel
                                lineBuffer = ""; // Reset the buffer for the next line
                            }
                        }
                    }
                    else if (result.type === 'answer') {
                        // Once we hit 'answer', finish the cot section and display it in the webview
                        if (currentSection === 'trace') {
                            currentSection = 'answer'; // Switch to answer section
                            autoDebugViewProvider.setNodeContent("trace", traceLines.concat(["SHOW_TRACE_BUTTON"]), "Click to view trace");
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
                autoDebugViewProvider.setNodeContent("suggestions", suggestionContent, "Click to view suggestions");
                vscode.commands.executeCommand('autodebug.showContentWebView', suggestionContent, 'Suggestions & Final Thoughts');
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
        // Convert ANSI codes to HTML spans, but keep original newlines (\n)
        const convert = new ansi_to_html_1.default({
            newline: false, // Keep \n instead of converting to <br>
            escapeXML: true // Escape HTML entities
        });
        const ansiHtml = convert.toHtml(content);
        let htmlContent;
        // const convert = new Convert({
        //     newline: true, // Convert newline characters to <br>
        //     escapeXML: true // Escape HTML entities
        // });
        // const ansiHtml = convert.toHtml(content);
        if (title === 'Trace') {
            // For trace, wrap the ANSI-converted HTML (with spans and \n) in <pre><code>
            // The browser will handle \n correctly inside <pre>
            // Convert ANSI codes to HTML for trace content
            // Wrap in pre/code for fixed-width font and preserving whitespace
            // const traceHtml = ansiHtml.replace(/\n/g, '<br>'); // No longer needed, <pre> handles \n
            htmlContent = `<pre><code>${ansiHtml}</code></pre>`;
        }
        else {
            // For suggestions (non-trace), use full pre-processing
            // 1. Extract raw code blocks and replace with placeholders
            const codeBlocksRaw = [];
            let i = 0;
            const contentWithPlaceholders = content.replace(/^( {0,3})(```|~~~)(.*?)?$\n([\s\S]*?)\n^( {0,3})(\2)$\n?/gm, (match, indentStart, fenceChars, lang, blockContent, indentEnd, fenceCharsEnd) => {
                const placeholder = `%%CODE_BLOCK_${i++}%%`;
                codeBlocksRaw.push({ placeholder: placeholder, rawContent: blockContent, lang: lang ? lang.trim() : '' });
                return placeholder + '\n';
            });
            // 2. Process content inside each fenced code block separately
            const codeBlocksProcessed = codeBlocksRaw.map(block => {
                let processed = block.rawContent;
                processed = processed.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); // Decode entities
                processed = processed.replace(/<\/?b>/g, ''); // Remove <b> tags
                const convert = new ansi_to_html_1.default({ newline: false, escapeXML: true }); // Convert ANSI
                processed = convert.toHtml(processed);
                return { placeholder: block.placeholder, htmlContent: processed, lang: block.lang };
            });
            // 3. Process the main content string (with placeholders) fully
            let fullyProcessedContent = contentWithPlaceholders;
            fullyProcessedContent = fullyProcessedContent.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); // Decode entities
            fullyProcessedContent = fullyProcessedContent.replace(/<\/?b>/g, ''); // Remove <b> tags
            const convertOuter = new ansi_to_html_1.default({ newline: false, escapeXML: true }); // Convert ANSI
            fullyProcessedContent = convertOuter.toHtml(fullyProcessedContent); // Result is HTML with spans and placeholders
            // 4. Configure and run markdown-it on the fully processed content
            const md = new markdown_it_1.default({
                html: true, // Allow the pre-generated HTML (spans)
                linkify: true,
                typographer: false,
            });
            // Render the string that already contains HTML spans etc.
            let renderedHtml = md.render(fullyProcessedContent);
            // 5. Inject the processed fenced code blocks
            codeBlocksProcessed.forEach(block => {
                const langClass = block.lang ? `language-${block.lang}` : '';
                const codeBlockHtml = `<pre class="hljs ${langClass}"><code>${block.htmlContent}</code></pre>`;
                const escapedPlaceholder = block.placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                // Regex needs to find placeholder within the rendered HTML (might be inside <p> etc)
                const regex = new RegExp(`(<p>\\s*${escapedPlaceholder}\\s*</p>)|(${escapedPlaceholder})`, 'g');
                renderedHtml = renderedHtml.replace(regex, (match, pTagMatch, standaloneMatch) => {
                    // Replace the placeholder paragraph or the standalone placeholder
                    return codeBlockHtml;
                });
            });
            // 6. Post-process to decode escaped spans/quotes within inline <code> tags
            renderedHtml = renderedHtml.replace(/<code>(.*?)<\/code>/gs, (match, codeContent) => {
                let decodedContent = codeContent;
                // Decode entities likely created by escapeXML: true for spans and quotes
                decodedContent = decodedContent.replace(/&lt;span/g, '<span') // <span
                    .replace(/&lt;\/span&gt;/g, '</span>') // </span>
                    .replace(/&quot;/g, '"') // Quotes in styles
                    .replace(/&amp;lt;/g, '&lt;') // Handle potential double escape of <
                    .replace(/&amp;gt;/g, '&gt;') // Handle potential double escape of >
                    .replace(/&amp;amp;/g, '&amp;'); // Handle potential double escape of &
                return `<code>${decodedContent}</code>`;
            });
            htmlContent = renderedHtml;
        }
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
function getWebviewContent(renderedContent, title) {
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
        /* Style for spans generated by ansi-to-html specifically inside inline code blocks */
        /* Reset padding/margin and ensure background doesn't conflict badly */
        :not(pre) > code > span {
           padding: 0 !important;
           margin: 0 !important;
           /* Inherit background to let the <code> background show through, */
           /* but allow span foreground color to override */
           /* background-color: inherit !important; /* Optional: uncomment if span backgrounds are problematic */
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
    ${renderedContent}
</body>
</html>`;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map