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
     * Starts debugging a specific build target and retrieves results.
     * @param target The build target to debug
     * @returns An object containing trace, chain-of-thought, and answer
     */
    async debugTarget(target) {
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
            const data = await res.json();
            return data;
        }
        catch (err) {
            vscode.window.showErrorMessage(`Error debugging target: ${err}`);
            return null;
        }
    }
    /**
     * Mock method for testing without backend
     */
    async mockDebugTarget(target) {
        return {
            trace: `Debugging target '${target}'...`,
            cot: `We began by building the target '${target}'. Compilation and linking succeeded with no errors.`,
            answer: `Build succeeded for target: ${target}`
        };
    }
    async mockFetchBuildTargets() {
        return ['all', 'clean', 'test', 'install'];
    }
}
exports.BackendInterface = BackendInterface;
//# sourceMappingURL=backendInterface.js.map