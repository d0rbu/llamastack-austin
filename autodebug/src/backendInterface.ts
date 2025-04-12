import * as vscode from 'vscode';
let fetch: any;
(async () => {
    fetch = (await import('node-fetch')).default;
})();
const BACKEND_URL = 'http://localhost:8000';

export interface DebugResponse {
    trace: string;
    cot: string;
    answer: string;
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
     * Starts debugging a specific build target and retrieves results.
     * @param target The build target to debug
     * @returns An object containing trace, chain-of-thought, and answer
     */
    async debugTarget(target: string): Promise<DebugResponse | null> {
        if (this.mock) {
            return this.mockDebugTarget(target);
        }

        try {
            const res = await fetch(`${BACKEND_URL}/debug_target`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target })
            });

            if (!res.ok) {
                throw new Error(`Failed to debug target: ${res.statusText}`);
            }

            const data = await res.json() as DebugResponse;
            return data;
        } catch (err) {
            vscode.window.showErrorMessage(`Error debugging target: ${err}`);
            return null;
        }
    }

    /**
     * Mock method for testing without backend
     */
    async mockDebugTarget(target: string): Promise<DebugResponse> {
        return {
            trace: `'${target}' running on gdb\n\n` +
                `Breakpoint 1, main () at main.c:10\n` +
                `10\tint main() {\n` +
                `11\t\tprintf("Hello, World!");\n` +
                `12\t}\n`,
            cot: `We began by building the target '${target}'.\nCompilation and linking succeeded with no errors.`,
            answer: `The issue with the target '${target}' was due to a missing header file.`
        };
    }

    async mockFetchBuildTargets(): Promise<string[]> {
        return ['all', 'clean', 'test', 'install'];
    }
} 
