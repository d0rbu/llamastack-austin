import * as vscode from 'vscode';
let fetch: any;
(async () => {
    fetch = (await import('node-fetch')).default;
})();
const BACKEND_URL = 'http://localhost:8000';

export interface DebugResponse {
    type: 'trace' | 'cot' | 'answer';
    content: string;
}

export class BackendInterface {
    private mock = true;

    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Sends the path to the Makefile and receives a list of build targets.
     * @param makefilePath Full path to the Makefile
     * @returns Array of build target strings
     */
    async fetchBuildTargets(makefilePath: string): Promise<string[]> {
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
                if (done) break;
    
                buffer += decoder.decode(value, { stream: true });
    
                let newlineIndex;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIndex).trim();
                    buffer = buffer.slice(newlineIndex + 1);
                    if (!line) continue;
    
                    try {
                        const parsed = JSON.parse(line);
                        yield parsed as DebugResponse;
                    } catch (e) {
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
    
        } catch (err) {
            vscode.window.showErrorMessage(`Error debugging target: ${err}`);
        }
    }
    

    async mockFetchBuildTargets(): Promise<string[]> {
        return ['all', 'clean', 'test', 'install'];
    }
} 
