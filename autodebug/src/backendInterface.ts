import * as vscode from 'vscode';
import * as readline from 'readline';
let stripAnsi: any;
(async () => {
    stripAnsi = (await import('strip-ansi')).default;
})();
let fetch: any;
(async () => {
    fetch = (await import('node-fetch')).default;
})();
const BACKEND_URL = 'http://192.168.0.41:8000';

export interface DebugResponse {
    type: 'trace' | 'cot' | 'answer';
    content: string;
}

export class BackendInterface {
    private mock = false;

    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Sends the path to the Makefile and receives a list of build targets.
     * @param makefilePath Full path to the Makefile
     * @returns Array of build target strings
     */
    async fetchBuildTargets(makefilePath: string): Promise<string[]> {
        return this.mockFetchBuildTargets();

        try {
            const res = await fetch(`${BACKEND_URL}/analyze_makefile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ makefile_path: makefilePath })
            });

            if (!res.ok) {
                throw new Error(`Failed to analyze Makefile: ${res.statusText}`);
            }

            const data = await res.json() as { targets: string[] };
            return data.targets || [];
        } catch (err) {
            vscode.window.showErrorMessage(`Error fetching build targets: ${err}`);
            return [];
        }
    }

    /**
     * Mock method for testing without backend
     */
    async *mockDebugTarget(target: string): AsyncGenerator<DebugResponse, void, unknown> {
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
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        for (const line of output.cot.split('\n')) {
            yield {
                type: 'cot',
                content: line
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        for (const line of output.answer.split('\n')) {
            yield {
                type: 'answer',
                content: line
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        return;
    }

    /**
     * Starts debugging a specific build target and retrieves results.
     * @param target The build target to debug
     * @returns An object containing trace, chain-of-thought, and answer
     */
    async *debugTarget(target: string, bugDescription: string): AsyncGenerator<DebugResponse, void, unknown> {
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
                body: JSON.stringify({ 
                    executable: target,
                    bug_description: bugDescription,
                })
            });
    
            if (!res.ok || !res.body) {
                throw new Error(`Failed to debug target: ${res.statusText}`);
            }

            const rl = readline.createInterface({
                input: res.body as NodeJS.ReadableStream,
                crlfDelay: Infinity
            });
            
            for await (const line of rl) {
                const trimmed = stripAnsi(line.trim());
                if (!trimmed) continue;
            
                try {
                    const parsed = JSON.parse(trimmed);
                    yield parsed as DebugResponse;
                } catch (e) {
                    vscode.window.showWarningMessage(`Non-JSON line received: ${trimmed}`);
                }
            }

            // Once the stream finishes, make a request to get the final answer
            const answerRes = await fetch(finalAnswerEndpoint, {
                method: 'GET', // Assuming GET for fetching the final answer
            });
    
            if (!answerRes.ok) {
                throw new Error(`Failed to fetch final answer: ${answerRes.statusText}`);
            }
    
            let answerText = '';
            try {
                const answerText = await answerRes.text();
                if (answerText.trim() === '') {
                    yield {
                        type: 'answer',
                        content: 'No final answer available'
                    };
                    return;
                }
            } catch (e) {
                vscode.window.showErrorMessage(`Error parsing final answer: ${e}`);
            }
    
            // Yield the final answer as a DebugResponse of type 'answer'
            yield {
                type: 'answer',
                content: answerText || 'No final answer available' // Assuming the answer is in answerData.answer
            };
    
        } catch (err) {
            vscode.window.showErrorMessage(`Error debugging target: ${err}`);
        }
    }
    

    async mockFetchBuildTargets(): Promise<string[]> {
        return ['test_executables/test_1', 'test_executables/test_2', 'test_executables/test_3'];
    }
} 
