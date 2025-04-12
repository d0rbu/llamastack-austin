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
exports.BackendInterface = void 0;
const vscode = __importStar(require("vscode"));
let fetch;
(async () => {
    fetch = (await import('node-fetch')).default;
})();
const BACKEND_URL = 'http://localhost:8000';
class BackendInterface {
    context;
    mock = true;
    constructor(context) {
        this.context = context;
    }
    /**
     * Sends the path to the Makefile and receives a list of build targets.
     * @param makefilePath Full path to the Makefile
     * @returns Array of build target strings
     */
    async fetchBuildTargets(makefilePath) {
        if (this.mock) {
            return this.mockFetchBuildTargets();
        }
        try {
            const res = await fetch(`${BACKEND_URL}/analyze_makefile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ makefile_path: makefilePath })
            });
            if (!res.ok) {
                throw new Error(`Failed to analyze Makefile: ${res.statusText}`);
            }
            const data = await res.json();
            return data.targets || [];
        }
        catch (err) {
            vscode.window.showErrorMessage(`Error fetching build targets: ${err}`);
            return [];
        }
    }
    /**
     * Mock method for testing without backend
     */
    async *mockDebugTarget(target) {
        const output = {
            trace: `'${target}' running on gdb\n\n` +
                `Breakpoint 1, main () at main.c:10\n` +
                `10\tint main() {\n` +
                `11\t\tprintf("Hello, World!");\n` +
                `12\t}\n`,
            cot: `We began by building the target '${target}'.\nCompilation and linking succeeded with no errors.`,
            answer: `The issue with the target '${target}' was due to a missing header file.`
        };
        for (const line of output.trace.split('\n')) {
            yield {
                type: 'trace',
                content: line
            };
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        for (const line of output.cot.split('\n')) {
            yield {
                type: 'cot',
                content: line
            };
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        for (const line of output.answer.split('\n')) {
            yield {
                type: 'answer',
                content: line
            };
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return;
    }
    /**
     * Starts debugging a specific build target and retrieves results.
     * @param target The build target to debug
     * @returns An object containing trace, chain-of-thought, and answer
     */
    async *debugTarget(target, bugDescription) {
        if (this.mock) {
            for await (const response of this.mockDebugTarget(target)) {
                yield response;
            }
            return;
        }
        const endpoint = `${BACKEND_URL}/debug_target`;
        const finalAnswerEndpoint = `${BACKEND_URL}/get_summary`; // Assuming the final answer can be fetched from this endpoint
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target })
            });
            if (!res.ok || !res.body) {
                throw new Error(`Failed to debug target: ${res.statusText}`);
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            // Read and process the stream of trace, cot, and answer
            while (true) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIndex).trim();
                    buffer = buffer.slice(newlineIndex + 1);
                    if (!line)
                        continue;
                    try {
                        const parsed = JSON.parse(line);
                        yield parsed;
                    }
                    catch (e) {
                        vscode.window.showWarningMessage(`Non-JSON line received: ${line}`);
                    }
                }
            }
            // Once the stream finishes, make a request to get the final answer
            const answerRes = await fetch(finalAnswerEndpoint, {
                method: 'GET', // Assuming GET for fetching the final answer
            });
            if (!answerRes.ok) {
                throw new Error(`Failed to fetch final answer: ${answerRes.statusText}`);
            }
            const answerData = await answerRes.json();
            // Yield the final answer as a DebugResponse of type 'answer'
            yield {
                type: 'answer',
                content: answerData.answer || 'No final answer available' // Assuming the answer is in answerData.answer
            };
        }
        catch (err) {
            vscode.window.showErrorMessage(`Error debugging target: ${err}`);
        }
    }
    async mockFetchBuildTargets() {
        return ['all', 'clean', 'test', 'install'];
    }
}
exports.BackendInterface = BackendInterface;
//# sourceMappingURL=backendInterface.js.map