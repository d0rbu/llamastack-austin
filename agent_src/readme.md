```markdown
# GDB Debugger Agent with Llama Stack

This script uses the Llama Stack library and a Large Language Model (LLM) to interactively debug a C/C++ executable using GDB's Machine Interface (MI). The agent attempts to find the root cause of a bug based on a natural language description.

## Prerequisites

1.  **Python:** Python 3.8 or higher.
2.  **GDB:** The GNU Debugger must be installed and accessible in your system's PATH.
3.  **Llama Stack Server:** A running Llama Stack server instance. This server connects to your chosen LLM (e.g., via Ollama, Together AI, etc.). See [Llama Stack Documentation](https://llama-stack.ai/docs) for setup instructions. Ensure the server is accessible (e.g., at `http://localhost:8321`).

## Setup

1.  **Get the Script:** Download or clone the `gdb_debugger_agent.py` script into a local directory.

2.  **Create Virtual Environment (Recommended):**
    ```bash
    cd /path/to/script/directory
    python -m venv .venv
    source .venv/bin/activate  # Linux/macOS
    # .venv\Scripts\activate  # Windows
    ```

3.  **Install Dependencies:** Create a `requirements.txt` file with the following content:
    ```txt
    llama-stack-client
    pygdbmi
    rich
    ```
    Then install them:
    ```bash
    pip install -r requirements.txt
    ```

4.  **Start Llama Stack Server:** Ensure your Llama Stack server is configured and running. Note its URL and the identifier of the LLM you want to use.

5.  **Configure Agent Script (Optional):**
    *   Open `gdb_debugger_agent.py`.
    *   Verify/update `LLAMA_STACK_URL` to match your server's address.
    *   Verify/update `DEFAULT_MODEL_ID` to the identifier of the LLM you want the agent to use (this can also be overridden via command-line argument).

## Running the Agent

Execute the script from your terminal, providing the path to the executable and a description of the bug.

```bash
python gdb_debugger_agent.py <path_to_executable> "<bug_description>" [--model-id <your_model_identifier>]
```

**Arguments:**

*   `<path_to_executable>`: (Required) The path to the compiled C/C++ executable (compile with `-g` for debug symbols).
*   `<bug_description>`: (Required) A natural language description of the bug or crash scenario (enclose in quotes).
*   `--model-id <your_model_identifier>`: (Optional) Override the default LLM model specified in the script.

## Example

1.  **Create a test program (`crash.c`):**
    ```c
    #include <stdio.h>
    #include <string.h>

    void cause_crash(char *input) {
        char buffer[10];
        strcpy(buffer, input); // Buffer overflow
        printf("Buffer: %s\n", buffer);
    }

    int main() {
        cause_crash("This is way too long");
        return 0;
    }
    ```

2.  **Compile with Debug Symbols:**
    ```bash
    gcc -g crash.c -o crash_executable
    ```

3.  **Run the Agent:**
    ```bash
    python gdb_debugger_agent.py ./crash_executable "The program crashes with a segmentation fault inside the cause_crash function due to strcpy."
    ```

The agent will then start GDB, interact with the LLM to get debugging commands (like `-exec-run`, `-stack-list-frames`, etc.), execute them, and print the interaction history until it stops (reaches max steps, finds a likely cause based on LLM response "DONE", or GDB terminates).

## Notes

*   The effectiveness of the agent heavily depends on the capabilities of the underlying LLM and the clarity of the `AGENT_INSTRUCTIONS` prompt.
*   The agent interacts directly with GDB's Machine Interface (MI). The LLM must suggest valid MI commands.
*   This is a proof-of-concept; error handling and command validation can be further improved.
```