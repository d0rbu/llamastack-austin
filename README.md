Okay, let's start building the core components. We'll begin with:

1.  A basic `GDBController` capable of starting GDB with a target, running it, and getting a backtrace upon crash using the GDB Machine Interface (MI).
2.  A placeholder `LLMInterface` that we can integrate with a real Llama model later.
3.  A simple `Orchestrator` to tie them together for a minimal crash analysis workflow.
4.  A small C program to act as our buggy target.

**Prerequisites:**

*   **Python 3:** Ensure you have Python 3 installed.
*   **GDB:** Ensure GDB is installed on your system.
*   **C Compiler:** Need `gcc` or `clang` to compile the example buggy program.
*   **(Optional but Recommended for LLM part):** `llama-cpp-python` library. You can install it via pip. Depending on your system, you might need specific compilation flags (e.g., for GPU acceleration). Check the `llama-cpp-python` documentation.
    ```bash
    pip install llama-cpp-python
    ```
*   **Llama Model:** Download a compatible Llama model file in GGUF format (e.g., from Hugging Face).

---

**1. `buggy_program.c` (Our Target Application)**

```c
// buggy_program.c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void cause_crash(char *data) {
    char buffer[10];
    // Intentionally cause a buffer overflow leading to a crash
    strcpy(buffer, data);
    printf("Data in buffer: %s\n", buffer); // This line might not be reached
}

void process_data(char *input) {
    printf("Processing data: %s\n", input);
    if (strlen(input) > 5) { // Simulate a condition leading to crash
        cause_crash(input);
    } else {
        printf("Input is safe.\n");
    }
}

int main(int argc, char *argv[]) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <input_string>\n", argv[0]);
        return 1;
    }

    printf("Starting buggy program...\n");
    process_data(argv[1]);
    printf("Program finished normally.\n"); // Will not reach here if crash occurs

    return 0;
}
```

**Compile it with debug symbols:**

```bash
gcc -g buggy_program.c -o buggy_program
```

---

**2. Python Code (`gdb_agent.py`)**

```python
import subprocess
import threading
import queue
import time
import re
import os
import argparse
from typing import List, Dict, Optional, Tuple

# Optional: Import llama_cpp only if available/needed later
try:
    from llama_cpp import Llama
    LLAMA_CPP_AVAILABLE = True
except ImportError:
    LLAMA_CPP_AVAILABLE = False
    print("WARN: llama-cpp-python not found. LLM features will be disabled.")
    print("Install it with: pip install llama-cpp-python")
    Llama = None # Define Llama as None if not available

# --- GDB Controller ---
class GDBController:
    """Handles interaction with a GDB subprocess using the MI3 interface."""

    def __init__(self, gdb_path="gdb", target_program=None):
        self.gdb_path = gdb_path
        self.target_program = target_program
        self.process = None
        self.stdout_queue = queue.Queue()
        self.stderr_queue = queue.Queue()
        self.stdout_thread = None
        self.stderr_thread = None
        self._token_id = 0
        self._command_responses = {} # Store responses keyed by token_id
        self._stop_event = threading.Event() # To signal threads to stop

        if not os.path.exists(target_program):
             raise FileNotFoundError(f"Target program not found: {target_program}")
        if not os.path.exists(gdb_path) and not self._is_in_path(gdb_path):
             raise FileNotFoundError(f"GDB executable not found: {gdb_path}")


    def _is_in_path(self, cmd):
        return any(os.access(os.path.join(path, cmd), os.X_OK) for path in os.environ["PATH"].split(os.pathsep))

    def _read_output(self, pipe, output_queue):
        """Reads lines from a pipe and puts them into a queue."""
        try:
            for line in iter(pipe.readline, ''):
                if self._stop_event.is_set():
                    break
                output_queue.put(line)
            # print(f"DEBUG: Exiting read thread for {pipe}")
        except ValueError: # Handle pipe closed exceptions
            # print(f"DEBUG: Pipe {pipe} likely closed.")
            pass
        finally:
            # print(f"DEBUG: Thread for {pipe} finished.")
            pass # Ensure thread terminates gracefully


    def start(self):
        """Starts the GDB subprocess with MI3 interpreter."""
        if self.process:
            print("WARN: GDB process already started.")
            return

        command = [self.gdb_path, "--interpreter=mi3"]
        if self.target_program:
            command.append(self.target_program)

        print(f"Starting GDB: {' '.join(command)}")
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True, # Use text mode for easier handling
            bufsize=1  # Line buffered
        )

        self._stop_event.clear() # Ensure event is clear before starting threads
        self.stdout_thread = threading.Thread(target=self._read_output, args=(self.process.stdout, self.stdout_queue), daemon=True)
        self.stderr_thread = threading.Thread(target=self._read_output, args=(self.process.stderr, self.stderr_queue), daemon=True)
        self.stdout_thread.start()
        self.stderr_thread.start()

        # Wait for GDB to be ready (optional but good practice)
        self._wait_for_prompt(timeout=5)
        print("GDB started successfully.")


    def _get_next_token(self):
        """Generates a unique token ID for commands."""
        self._token_id += 1
        return str(self._token_id)

    def send_command(self, command: str, timeout: float = 10.0) -> Tuple[List[str], List[str]]:
        """
        Sends a command to GDB MI, waits for the response, and returns parsed output.

        Returns:
            A tuple containing:
            - List of relevant result lines (async/stream records related to the command).
            - List of console stream output lines (`~` prefix).
        """
        if not self.process or self.process.poll() is not None:
            raise ConnectionError("GDB process is not running.")

        token = self._get_next_token()
        full_command = f"{token}-{command}\n"
        # print(f"DEBUG: Sending command: {full_command.strip()}")
        self.process.stdin.write(full_command)
        self.process.stdin.flush()

        return self._read_response(token, timeout)

    def _read_response(self, token: str, timeout: float) -> Tuple[List[str], List[str]]:
        """
        Reads output from GDB until the command associated with 'token' completes or times out.
        Parses different types of MI output records.
        """
        start_time = time.time()
        results = []
        console_output = []
        other_async_output = [] # Store async output not directly tied to this token
        end_marker = f"^{token}" # Partial end marker, needs type like ^done
        done_marker = f"{token}^done"
        running_marker = f"{token}^running"
        error_marker = f"{token}^error"
        exit_marker = f"{token}^exit" # GDB exiting
        stopped_marker = "*stopped" # Async record indicating program stopped

        response_complete = False
        while time.time() - start_time < timeout:
            try:
                line = self.stdout_queue.get(timeout=0.1) # Short timeout for queue check
                # print(f"DEBUG STDOUT: {line.strip()}") # Verbose GDB MI output

                line = line.strip()
                if not line: continue

                # Check for completion/error markers *specific to our token*
                if line.startswith(done_marker) or line.startswith(running_marker) or \
                   line.startswith(error_marker) or line.startswith(exit_marker):
                    # print(f"DEBUG: Found end marker for token {token}: {line}")
                    results.append(line)
                    response_complete = True
                    # Keep reading until the (gdb) prompt to ensure all output flushed
                    self._wait_for_prompt(timeout=1.0)
                    break
                # Check for general *stopped async notification
                elif line.startswith(stopped_marker):
                     print(f"DEBUG: Program stopped: {line}")
                     results.append(line) # Include stop info in results
                     # Program stopping might conclude our command implicitly
                     # response_complete = True # Don't assume completion here, wait for ^done etc.

                # Handle different MI output types
                elif line.startswith(token): # Result record for our command
                    results.append(line)
                elif line.startswith( ("=", "*", "+") ): # Async records (like *stopped)
                    if line.startswith(stopped_marker): # Already handled above, but catch again
                         if line not in results: results.append(line)
                    else:
                         other_async_output.append(line) # Could be state changes
                elif line.startswith("~"): # Console stream output
                    console_output.append(line[1:].strip('"').replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"'))
                elif line.startswith("&"): # Log stream output (gdb logs)
                    # print(f"GDB LOG: {line[1:].strip()}")
                     pass # Usually ignore GDB's own logs
                elif line.startswith("@"): # Target stream output (program's stdout)
                     # print(f"TARGET OUT: {line[1:].strip()}")
                     pass # Might want to capture this later

            except queue.Empty:
                if self.process.poll() is not None:
                     print("ERROR: GDB process terminated unexpectedly.")
                     raise ConnectionError("GDB process terminated.")
                # If queue is empty, just continue waiting if timeout not reached
                continue

        if not response_complete:
            print(f"WARN: Timeout waiting for response to token {token} for command.")
            # Try to read remaining output to avoid blocking later
            while not self.stdout_queue.empty():
                 try:
                     rem_line = self.stdout_queue.get_nowait()
                     # print(f"DEBUG LEFTOVER: {rem_line.strip()}")
                 except queue.Empty:
                     break
            # Raise or return indication of timeout? For now, return what we got.

        # Check stderr for errors
        while not self.stderr_queue.empty():
            try:
                err_line = self.stderr_queue.get_nowait()
                print(f"GDB STDERR: {err_line.strip()}")
            except queue.Empty:
                break

        # print(f"DEBUG: Returning results for token {token}: {results}")
        # print(f"DEBUG: Returning console for token {token}: {console_output}")
        return results, console_output


    def _wait_for_prompt(self, timeout=2.0):
        """Waits for the (gdb) prompt indicating readiness."""
        start_time = time.time()
        prompt_found = False
        while time.time() - start_time < timeout:
             try:
                 # Intentionally read with short timeout to avoid blocking forever
                 # if GDB is stuck or prompt format changes.
                 line = self.stdout_queue.get(timeout=0.1)
                 # print(f"DEBUG PROMPT WAIT: {line.strip()}")
                 if line.strip() == "(gdb)":
                     prompt_found = True
                     break
             except queue.Empty:
                 if self.process.poll() is not None: return # GDB exited
                 continue
        # if not prompt_found: print("WARN: Did not detect (gdb) prompt within timeout.")


    def set_args(self, args: List[str]):
        """Sets program arguments using -exec-arguments."""
        arg_str = " ".join(f'"{a}"' for a in args) # Basic quoting
        results, _ = self.send_command(f"exec-arguments {arg_str}")
        if not any(res.endswith("^done") for res in results):
            print(f"WARN: Setting arguments may have failed. Response: {results}")

    def run(self) -> Tuple[List[str], List[str]]:
        """Runs the program using -exec-run. Waits for stop or exit."""
        print("Running program...")
        results, console = self.send_command("exec-run", timeout=60) # Increase timeout for run
        # The response might be ^running immediately, then later *stopped
        # We rely on _read_response capturing the *stopped event as part of results
        return results, console

    def get_backtrace(self) -> Optional[List[Dict]]:
        """Gets the current stack backtrace using -stack-list-frames."""
        results, _ = self.send_command("stack-list-frames")

        # Basic parsing of MI output for stack frames
        # Example: 1^done,stack=[frame={level="0",addr="0x00005555555551a9",func="cause_crash",file="buggy_program.c",fullname="/path/to/buggy_program.c",line="9"},frame={level="1",addr="0x00005555555551f5",func="process_data",file="buggy_program.c",fullname="/path/to/buggy_program.c",line="17"},frame={level="2",addr="0x000055555555524b",func="main",file="buggy_program.c",fullname="/path/to/buggy_program.c",line="29"}]
        stack = []
        for line in results:
            if line.startswith(f"{self._token_id}^done"): # Or check token directly if stored
                 match = re.search(r"stack=\[(.*)\]", line)
                 if match:
                     frames_str = match.group(1)
                     # Split frames - this is fragile, assumes structure `frame={...},frame={...}`
                     frame_matches = re.findall(r"frame=(\{.*?\})(?:,|$)", frames_str)
                     for frame_str in frame_matches:
                        frame_dict = {}
                        # Extract key-value pairs like key="value"
                        kv_matches = re.findall(r'([\w-]+)="(.*?)"(?:,|$)', frame_str)
                        for key, value in kv_matches:
                            # Basic unescaping, might need more robust handling
                            value = value.replace('\\\\', '\\').replace('\\"', '"')
                            frame_dict[key] = value
                        if frame_dict:
                            stack.append(frame_dict)
                     return stack # Return successfully parsed stack
        print("WARN: Could not parse backtrace from GDB output.")
        print(f"DEBUG: GDB output for backtrace: {results}")
        return None

    def close(self):
        """Closes the GDB process gracefully."""
        if self.process and self.process.poll() is None:
            print("Closing GDB...")
            try:
                # Don't wait indefinitely for exit command response if GDB is stuck
                self.send_command("gdb-exit", timeout=2.0)
            except ConnectionError:
                 print("WARN: Connection error during GDB exit, likely already terminated.")
            except Exception as e:
                 print(f"WARN: Exception during GDB exit command: {e}")
            finally:
                 # Ensure threads know to stop
                 self._stop_event.set()
                 # Give threads a moment to exit from blocking reads
                 time.sleep(0.2)

                 # Attempt cleanup
                 try:
                     self.process.stdin.close()
                 except OSError: pass # Ignore errors if already closed
                 try:
                      # Wait briefly for process to terminate after exit command
                     self.process.wait(timeout=2.0)
                 except subprocess.TimeoutExpired:
                     print("WARN: GDB process did not exit gracefully, terminating.")
                     self.process.terminate() # Force kill if needed
                     try:
                         self.process.wait(timeout=1.0) # Wait after terminate
                     except subprocess.TimeoutExpired:
                         print("ERROR: Failed to terminate GDB process.")
                         self.process.kill() # Final resort
                 except Exception as e:
                     print(f"Error during GDB process wait/terminate: {e}")

                 # Join threads after process termination attempt
                 if self.stdout_thread and self.stdout_thread.is_alive(): self.stdout_thread.join(timeout=1.0)
                 if self.stderr_thread and self.stderr_thread.is_alive(): self.stderr_thread.join(timeout=1.0)

                 self.process = None
                 print("GDB closed.")
        else:
             print("GDB process already closed or not started.")


# --- LLM Interface ---
class LLMInterface:
    """Handles interaction with the local LLM."""
    def __init__(self, model_path: Optional[str] = None):
        self.model_path = model_path
        self.llm = None
        if LLAMA_CPP_AVAILABLE and self.model_path:
            if os.path.exists(self.model_path):
                try:
                    # Adjust parameters as needed (n_gpu_layers, n_ctx, etc.)
                    self.llm = Llama(model_path=self.model_path, verbose=False, n_ctx=2048)
                    print(f"LLM loaded successfully from: {self.model_path}")
                except Exception as e:
                    print(f"ERROR: Failed to load LLM model: {e}")
                    self.llm = None
            else:
                print(f"WARN: LLM model path not found: {self.model_path}. LLM disabled.")
                self.llm = None
        elif LLAMA_CPP_AVAILABLE and not self.model_path:
             print("INFO: No LLM model path provided. LLM disabled.")
        # else: LLAMA_CPP_AVAILABLE is False, warning printed earlier


    def analyze_crash(self, backtrace: List[Dict]) -> str:
        """Analyzes a crash backtrace using the LLM."""
        if not self.llm:
            return "LLM analysis skipped (LLM not loaded)."

        # Format the backtrace for the prompt
        formatted_bt = "\n".join(
            f"Frame {frame.get('level', '?')}: {frame.get('func', '??')} at {frame.get('file', '?')}:{frame.get('line', '?')} (addr: {frame.get('addr', '?')})"
            for frame in backtrace
        )

        prompt = f"""You are an expert C/C++ debugger analyzing a program crash reported by GDB.
The program stopped execution due to a signal (likely SEGV, BUS, FPE, etc.).
Here is the stack backtrace:
--- Backtrace Start ---
{formatted_bt}
--- Backtrace End ---

Based *only* on this backtrace, what is the most likely immediate cause of the crash (e.g., null pointer dereference, buffer overflow, division by zero)?
Identify the function and source line where the crash occurred (Frame 0).
Suggest the *next single* GDB command (like `info locals`, `print <variable_name>`, `frame <level>`) that would be most useful to investigate the state in the crashing frame (Frame 0). Be specific.
Keep your analysis concise.

Analysis:
Likely immediate cause:
Crashing function/line:
Suggested next GDB command:
"""
        try:
            # print(f"DEBUG: Sending prompt to LLM:\n{prompt}")
            response = self.llm(prompt, max_tokens=250, temperature=0.2, stop=["\n\n"]) # Adjust params as needed
            analysis_text = response['choices'][0]['text'].strip()
            # print(f"DEBUG: Received analysis from LLM:\n{analysis_text}")
            return analysis_text
        except Exception as e:
            print(f"ERROR: LLM analysis failed: {e}")
            return f"LLM analysis failed: {e}"


# --- Orchestrator ---
class Orchestrator:
    """Manages the debugging session."""
    def __init__(self, gdb_path: str, target_program: str, target_args: List[str], model_path: Optional[str]):
        self.gdb_controller = GDBController(gdb_path=gdb_path, target_program=target_program)
        self.llm_interface = LLMInterface(model_path=model_path)
        self.target_args = target_args

    def run_basic_crash_analysis(self):
        """Performs a simple run-to-crash and basic analysis."""
        try:
            self.gdb_controller.start()
            self.gdb_controller.set_args(self.target_args)
            results, console_output = self.gdb_controller.run()

            print("\n--- Program Console Output ---")
            for line in console_output:
                 print(line)
            print("--- End Console Output ---\n")

            # Check if the program stopped due to a signal (crash)
            stopped_info = None
            for res in results:
                if res.startswith("*stopped"):
                    stopped_info = res
                    break

            if stopped_info and "signal-name" in stopped_info:
                print(f"Program stopped due to signal: {stopped_info}")
                backtrace = self.gdb_controller.get_backtrace()

                if backtrace:
                    print("\n--- Backtrace ---")
                    for frame in backtrace:
                         print(f" Level {frame.get('level', '?'):<2}: Addr: {frame.get('addr', '?'):<18} | Func: {frame.get('func', '??'):<20} | File: {frame.get('file', '?')}:{frame.get('line', '?')}")
                    print("--- End Backtrace ---\n")

                    analysis = self.llm_interface.analyze_crash(backtrace)
                    print("\n--- LLM Crash Analysis ---")
                    print(analysis)
                    print("--- End LLM Analysis ---\n")
                else:
                    print("Failed to retrieve backtrace after crash.")
            elif stopped_info and "reason=\"exited-normally\"" in stopped_info:
                 print("Program exited normally.")
            else:
                print("Program stopped for an unknown or unexpected reason.")
                print(f"GDB Stop Info: {stopped_info}")
                print(f"Full GDB Result: {results}")


        except FileNotFoundError as e:
             print(f"ERROR: {e}")
        except ConnectionError as e:
             print(f"ERROR: GDB connection error: {e}")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
            import traceback
            traceback.print_exc() # Print full traceback for unexpected errors
        finally:
            self.gdb_controller.close()

# --- Main Execution ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run GDB agent for basic crash analysis.")
    parser.add_argument("target_program", help="Path to the executable to debug.")
    parser.add_argument("target_args", nargs='*', help="Arguments to pass to the target program.")
    parser.add_argument("--gdb-path", default="gdb", help="Path to the GDB executable.")
    parser.add_argument("--model-path", default=None, help="Path to the GGUF Llama model file for analysis.")

    args = parser.parse_args()

    # Ensure target program exists before starting orchestrator
    if not os.path.exists(args.target_program):
         print(f"Error: Target program not found at '{args.target_program}'")
         exit(1)
    # Check if compiled with debug symbols (basic check)
    # This requires `readelf` or similar, skip for now, but could be added
    print("Starting GDB Agent...")
    orchestrator = Orchestrator(
        gdb_path=args.gdb_path,
        target_program=args.target_program,
        target_args=args.target_args,
        model_path=args.model_path
    )
    orchestrator.run_basic_crash_analysis()
    print("GDB Agent finished.")

```

**How to Run:**

1.  **Save:** Save the C code as `buggy_program.c` and the Python code as `gdb_agent.py`.
2.  **Compile:** `gcc -g buggy_program.c -o buggy_program`
3.  **Download Model (Optional):** Get a Llama GGUF model file (e.g., `llama-2-7b-chat.Q4_K_M.gguf`) and note its path.
4.  **Run the Agent:**
    *   **Without LLM:**
        ```bash
        python gdb_agent.py ./buggy_program "This string is too long and will crash"
        ```
    *   **With LLM:** (Replace `/path/to/your/model.gguf` with the actual path)
        ```bash
        # Make sure you have llama-cpp-python installed
        pip install llama-cpp-python

        # Run with model path
        python gdb_agent.py ./buggy_program "This string is too long and will crash" --model-path /path/to/your/model.gguf
        ```

**Explanation:**

1.  **`buggy_program.c`:** A simple C program designed to crash via `strcpy` buffer overflow if the input string is longer than 5 characters. Compiled with `-g` for debug info.
2.  **`GDBController`:**
    *   Starts `gdb --interpreter=mi3 ./buggy_program`.
    *   Uses separate threads (`_read_output`) to continuously read GDB's `stdout` and `stderr` without blocking the main thread.
    *   `send_command` adds a unique token (like `1-`, `2-`) to commands and uses `_read_response` to wait for the corresponding GDB MI response (e.g., `1^done`, `*stopped`).
    *   `_read_response` parses different output types (`^`, `*`, `~`, `&`, `@`) and waits for a completion marker (`^done`, `^error`, `^running`, `^exit`) or a stop event (`*stopped`). **Note:** MI parsing here is basic and might need refinement for complex GDB outputs.
    *   Provides methods like `set_args`, `run`, `get_backtrace`, and `close`.
    *   `get_backtrace` uses basic regex to parse the frame information from the `-stack-list-frames` output.
    *   Includes cleanup logic in `close`.
3.  **`LLMInterface`:**
    *   Loads a GGUF model using `llama-cpp-python` if the library is installed and a valid path is provided.
    *   `analyze_crash` formats the backtrace into a prompt asking the LLM for the likely cause and the next GDB command.
    *   Handles cases where the LLM isn't available or fails.
4.  **`Orchestrator`:**
    *   Initializes the `GDBController` and `LLMInterface`.
    *   `run_basic_crash_analysis`:
        *   Starts GDB.
        *   Sets program arguments.
        *   Runs the program.
        *   Checks the stop reason from GDB.
        *   If it crashed (stopped due to a signal), it gets the backtrace.
        *   Prints the backtrace.
        *   Sends the backtrace to the `LLMInterface` for analysis.
        *   Prints the LLM's analysis.
        *   Ensures GDB is closed properly.
5.  **`if __name__ == "__main__":`:**
    *   Uses `argparse` to handle command-line arguments for the target program, its arguments, the GDB path, and the optional LLM model path.
    *   Creates the `Orchestrator` and starts the analysis.

This code provides the foundational structure. The next steps would involve:

*   **More Robust MI Parsing:** Handle edge cases and complex data structures in GDB's output.
*   **Iterative Debugging:** Implement logic in the Orchestrator to parse the LLM's suggested command, execute it via `GDBController`, get the new state (variable values, etc.), and feed it back to the LLM for the next step.
*   **State Management:** Add the `StateManager` component.
*   **Source Code Retrieval:** Implement the `SourceCodeRetriever`.
*   **Error Handling:** Improve handling of GDB errors, LLM errors, and timeouts.
*   **Advanced GDB Commands:** Support commands like `print`, `info locals`, `frame`, setting breakpoints, etc.
