# gdb_debugger_agent.py

import argparse
import subprocess
import time
import uuid
import re
import json # Import json for pretty printing GDB output
from typing import List, Dict, Any, Optional

# Llama Stack Imports
from llama_stack_client import LlamaStackClient, Agent, AgentEventLogger
from llama_stack_client.types.agents import Turn # Correct import for the Turn object
# Note: We will use dictionaries for messages as per examples, so Message import might not be needed.

# Other Imports
from pygdbmi.gdbcontroller import GdbController
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax

# --- Configuration ---
LLAMA_STACK_URL = "http://localhost:8321"
# Choose a model ID available on your Llama Stack server
# You might need to list models first if unsure: client.models.list()
# Example using a placeholder - REPLACE THIS if needed
DEFAULT_MODEL_ID = "meta-llama/Meta-Llama-3-8B-Instruct"
MAX_DEBUG_STEPS = 15 # Limit the number of interactions

AGENT_INSTRUCTIONS = """
You are an expert C/C++ debugger using GDB's Machine Interface (MI).
Your goal is to help the user find the root cause of a bug in their program.
The user will provide an initial bug description and the path to an executable compiled with debug symbols (-g).
You will interact with a GDB MI interface. In each turn, you will be shown the history of MI commands sent and the corresponding GDB MI output.
Based on the bug description and the GDB history, suggest the *single* next GDB MI command to execute.
Focus on commands that help diagnose crashes, inspect state, and step through execution.
Prioritize commands like: -exec-run, -exec-continue, -exec-next, -exec-step, -stack-list-frames, -stack-list-variables --simple 1, -data-evaluate-expression <var_name>, -break-insert <location>.
Ensure the location for -break-insert is valid (e.g., function name, file:line_number).
Format your response *only* as the GDB MI command itself, without any explanation or surrounding text.
Example response: `-exec-run`
Another example: `-break-insert main`
Another example: `-stack-list-frames`
If you believe the root cause is likely found (e.g., after identifying a crash location and inspecting relevant variables) or GDB has exited, respond *only* with the word: `DONE`.
"""

console = Console()

# --- Helper Functions ---

def find_llm_model(client: LlamaStackClient, preferred_model_id: Optional[str] = None) -> str:
    """Finds an available LLM model, preferring the one specified."""
    try:
        models = client.models.list()
        llm_models = [m for m in models if m.model_type == "llm"]
        if not llm_models:
            raise ValueError("No LLM models found on the Llama Stack server.")

        # Try preferred model first
        if preferred_model_id:
            for m in llm_models:
                if m.identifier == preferred_model_id:
                    console.print(f"[green]Using preferred model:[/green] {preferred_model_id}")
                    return m.identifier
            console.print(f"[yellow]Warning:[/yellow] Preferred model '{preferred_model_id}' not found. Selecting another LLM.")

        # Select the first available LLM
        # Sort for some predictability if preferred not found
        llm_models.sort(key=lambda m: m.identifier)
        selected_model = llm_models[0].identifier
        console.print(f"[green]Using model:[/green] {selected_model}")
        return selected_model
    except Exception as e:
        console.print(f"[red]Error listing models from Llama Stack:[/red] {e}")
        console.print(f"Please ensure the Llama Stack server is running at {LLAMA_STACK_URL} and accessible.")
        exit(1)

def extract_gdb_command(llm_response: str) -> Optional[str]:
    """Extracts the GDB MI command from the LLM's response."""
    llm_response = llm_response.strip()
    # Strict check: Must start with '-' or be exactly 'DONE'
    if llm_response == "DONE":
        return "DONE"
    # Regex to match MI command format more closely: starts with '-', followed by words separated by '-'
    if re.match(r"^-[a-zA-Z0-9-]+(\s+.*)?$", llm_response):
         return llm_response

    console.print(f"[yellow]Warning:[/yellow] LLM response doesn't look like a valid GDB MI command or DONE: '{llm_response}'")
    return None # Indicate an invalid or unexpected response

def format_gdb_output_for_llm(gdb_responses: List[Dict[str, Any]]) -> str:
    """Formats the list of GDB MI responses into a concise string for the LLM."""
    formatted = []
    for response in gdb_responses:
        # Prioritize key info: type, class, message, payload summary
        res_type = response.get('type', 'N/A')
        res_class = response.get('class', '') # Often present for results/notifications
        res_msg = response.get('message', '') # Short status like 'done', 'running', 'error'
        payload = response.get('payload', {})

        # Basic summary
        summary = f"  Type: {res_type}"
        if res_class: summary += f", Class: {res_class}"
        if res_msg: summary += f", Msg: {res_msg}"

        # Add selective payload info (avoid excessive verbosity)
        if payload:
            if isinstance(payload, dict):
                 # Show keys or specific important keys
                 payload_summary = str(list(payload.keys()))
                 if len(payload_summary) > 100: payload_summary = payload_summary[:100] + "..."
                 summary += f", PayloadKeys: {payload_summary}"
            elif isinstance(payload, str):
                 payload_summary = payload
                 if len(payload_summary) > 100: payload_summary = payload_summary[:100] + "..."
                 summary += f", Payload: {payload_summary}"
            # Add more specific handling for common payloads like 'frame', 'variables' if needed

        formatted.append(summary)

    return "\n".join(formatted) if formatted else "  (No explicit GDB output)"

def print_gdb_output_human(gdb_responses: List[Dict[str, Any]]):
    """Prints GDB output in a more human-readable format using Rich."""
    if not gdb_responses:
        console.print("[grey50]No GDB output received.[/grey50]")
        return

    # Try to format as JSON for structured view
    try:
        # Convert pygdbmi MixedDict objects to plain dicts for json serialization
        plain_dicts = [dict(r) for r in gdb_responses]
        out_str = json.dumps(plain_dicts, indent=2)
        console.print(Syntax(out_str, "json", theme="default", line_numbers=False, word_wrap=True))
    except Exception as e:
        console.print(f"[yellow]Could not format GDB output as JSON ({e}), printing raw:[/yellow]")
        # Fallback to raw printing if JSON fails
        for response in gdb_responses:
             console.print(response)


def is_gdb_terminated(gdb_responses: List[Dict[str, Any]]) -> bool:
    """Checks if GDB output indicates the program or GDB itself has terminated."""
    if not gdb_responses: # If GDB controller failed/exited before responding
        return True
    for response in gdb_responses:
        # Program exited via GDB notification
        if response.get("type") == "notify" and response.get("message") == "thread-group-exited":
             console.print("[bold yellow]Detected 'thread-group-exited'[/bold yellow]")
             return True
        # GDB itself exited via result
        if response.get("type") == "result" and response.get("message") == "exit":
            console.print("[bold yellow]Detected GDB 'exit' result[/bold yellow]")
            return True
        # Program stopped for a reason indicating termination
        if response.get("type") == "notify" and response.get("class") == "stopped":
            payload = response.get("payload", {})
            reason = payload.get("reason")
            # SIGSEGV, SIGABRT etc. often indicate the crash we are looking for, *don't* terminate here yet.
            # Let the LLM analyze the crash state.
            if reason in ["exited-normally", "exited"]:
                 console.print(f"[bold yellow]Detected stopped reason:[/bold yellow] {reason}")
                 return True
            # Example: if payload.get('signal-name') == 'SIGKILL': return True
    return False

# --- Main Agent Logic ---

def main(executable_path: str, bug_description: str, model_id: Optional[str]):
    console.print(Panel(f"Starting GDB Debugger Agent\nExecutable: {executable_path}\nBug: {bug_description}", title="Setup", style="bold blue"))

    gdbmi: Optional[GdbController] = None
    client: Optional[LlamaStackClient] = None

    try:
        # 1. Initialize GDB Controller
        console.print("Starting GDB...")
        # Consider adding --nx to prevent loading .gdbinit for security/predictability
        gdbmi = GdbController(gdb_args=["--nx", "--quiet"])
        console.print("[green]GDB MI Controller Initialized.[/green]")

        # Load the executable
        console.print(f"Loading executable '{executable_path}' into GDB...")
        # Use a specific command token for easier matching if needed later
        load_token = "load-exec"
        response = gdbmi.write(f'{load_token}-file-exec-and-symbols "{executable_path}"', timeout_sec=10)
        print_gdb_output_human(response)

        # Check if loading succeeded (look for the corresponding 'done' result)
        load_successful = any(r.get("token") == load_token and r.get("type") == "result" and r.get("class") == "done" for r in response)
        if not load_successful:
             console.print(f"[red]Error:[/red] Failed to load executable in GDB. Check GDB output above.")
             # Check for specific error messages
             for r in response:
                  if r.get("type") == "result" and r.get("class") == "error":
                       console.print(f"  GDB Error Payload: {r.get('payload')}")
             return

        # 2. Initialize Llama Stack Client
        console.print(f"Connecting to Llama Stack server at {LLAMA_STACK_URL}...")
        client = LlamaStackClient(base_url=LLAMA_STACK_URL)
        try:
            client.health.get()
            console.print("[green]Connected to Llama Stack server.[/green]")
        except Exception as e:
            console.print(f"[red]Error connecting to Llama Stack server:[/red] {e}")
            return

        # 3. Setup Agent
        selected_model_id = find_llm_model(client, model_id or DEFAULT_MODEL_ID)
        agent = Agent(client, model=selected_model_id, instructions=AGENT_INSTRUCTIONS)
        session_id = agent.create_session(session_name=f"gdb-debug-{uuid.uuid4().hex}")
        console.print(f"Created agent session: {session_id}")

        # 4. Debugging Loop
        history: List[Dict[str, str]] = []
        current_step = 0
        gdb_alive = True

        while current_step < MAX_DEBUG_STEPS and gdb_alive:
            current_step += 1
            console.print(Panel(f"Debugging Step {current_step}/{MAX_DEBUG_STEPS}", style="bold magenta"))

            # Prepare context for LLM
            prompt_context = f"Initial Bug Description: {bug_description}\n\n"
            prompt_context += "GDB MI Interaction History:\n"
            if not history:
                prompt_context += "(No commands executed yet. Executable is loaded.)\n"
            else:
                for i, item in enumerate(history):
                    # Limit history length if it gets too long for the context window
                    if i >= len(history) - 5: # Example: Only show last 5 interactions
                         prompt_context += f"Step {i+1}:\n-> Command: {item['command']}\n<- Output Summary:\n{item['output_summary']}\n"
            prompt_context += "\nSuggest the *single* next GDB MI command (or DONE):"

            # Use dictionary format for messages
            messages = [{"role": "user", "content": prompt_context}]

            # Get next command from LLM
            console.print("Querying LLM for next GDB command...")
            llm_response_content = ""
            try:
                response_stream = agent.create_turn(
                    messages=messages,
                    session_id=session_id,
                    stream=True
                )

                final_turn: Optional[Turn] = None # Use the correct Turn type
                logger = AgentEventLogger() # Logger can still be used for printing events

                for stream_chunk in response_stream: # Iterate through stream chunks
                     # logger.log_event(stream_chunk) # Log event if needed (can be verbose)
                     # Instead of full log, maybe just print delta?
                     payload = stream_chunk.event.payload
                     if payload.event_type == "turn_delta":
                         if hasattr(payload, 'text') and payload.text:
                            print(payload.text, end="", flush=True) # Print delta text

                     # Check for completion event within the chunk's event payload
                     if payload.event_type == "turn_complete":
                         final_turn = payload.turn # Access the turn object from the payload
                         # console.print("\n[grey50]Turn complete event received.[/grey50]")
                         break # Exit loop once turn is complete


                if final_turn:
                    # Make sure content is string. It might be list for multi-modal.
                    if isinstance(final_turn.output_message.content, str):
                        llm_response_content = final_turn.output_message.content.strip()
                        print() # Newline after streaming output
                        console.print(f"[bold cyan]LLM Suggested Raw:[/bold cyan] '{llm_response_content}'")
                    else:
                        console.print("[red]Error:[/red] LLM response content is not a simple string.")
                        # Handle or log complex content if necessary
                        llm_response_content = "" # Force empty response if not string
                else:
                     console.print("\n[red]Error:[/red] Did not receive turn_complete event or final Turn object from LLM stream.")
                     break # Exit loop if LLM fails

            except Exception as e:
                console.print(f"\n[red]Error during LLM interaction:[/red] {e}")
                break # Exit loop on LLM error

            # Parse and validate command
            gdb_command = extract_gdb_command(llm_response_content)

            if not gdb_command:
                console.print("[yellow]Could not extract a valid command from LLM response. Stopping.[/yellow]")
                break

            if gdb_command == "DONE":
                console.print("[bold green]LLM indicated debugging is complete. Stopping.[/bold green]")
                break

            # Execute command in GDB
            console.print(f"Executing GDB command: [bold yellow]{gdb_command}[/bold yellow]")
            gdb_responses = []
            try:
                # Use a unique token for each command
                cmd_token = f"cmd-{current_step}"
                gdb_responses = gdbmi.write(f"{cmd_token}{gdb_command}", timeout_sec=20) # Increased timeout
                console.print("GDB Output:")
                print_gdb_output_human(gdb_responses)

                # Check for errors reported by GDB for this specific command
                cmd_error = any(r.get("token") == cmd_token and r.get("type") == "result" and r.get("class") == "error" for r in gdb_responses)
                if cmd_error:
                    console.print(f"[red]GDB Error occurred for command '{gdb_command}'. See output above.[/red]")
                    # Let LLM see the error in the history and potentially correct course

            except Exception as e:
                # This usually means GDB crashed or the connection died
                console.print(f"[bold red]FATAL:[/bold red] Error communicating with GDB: {e}")
                console.print("Assuming GDB has terminated.")
                gdb_alive = False
                formatted_output_summary = f"Error communicating with GDB: {e}"
                # No GDB responses available in this case
                gdb_responses = [] # Ensure it's an empty list

            # Format output summary *after* potential GDB comms error
            formatted_output_summary = format_gdb_output_for_llm(gdb_responses)

            # Record history (even if GDB communication failed)
            history.append({
                "command": gdb_command,
                "output_summary": formatted_output_summary,
                "full_output": gdb_responses # Store full output for potential later analysis if needed
                })

            # Check for GDB termination based on the *received* output
            if gdb_alive and is_gdb_terminated(gdb_responses):
                 console.print("[bold red]GDB process or target program appears to have terminated based on output. Stopping.[/bold red]")
                 gdb_alive = False # Stop the loop

        # End of loop
        if current_step >= MAX_DEBUG_STEPS:
            console.print(f"[yellow]Reached maximum debugging steps ({MAX_DEBUG_STEPS}). Stopping.[/yellow]")

        console.print(Panel("Debugging Session Summary", style="bold blue"))
        console.print(f"Initial Bug: {bug_description}")
        console.print(f"Executable: {executable_path}")
        console.print(f"Total Steps Attempted: {current_step}")
        console.print(f"Final Status: {'GDB Terminated' if not gdb_alive else ('LLM Stopped' if gdb_command == 'DONE' else 'Max Steps Reached')}")
        console.print("Interaction History (Summarized):")
        if history:
            for i, item in enumerate(history):
                console.print(f" Step {i+1}:")
                console.print(f"  Command: {item['command']}")
                console.print(f"  Output Summary: \n{item['output_summary']}")
                console.print("-" * 20)
        else:
             console.print("(No commands were executed)")


    except Exception as e:
        console.print(f"[bold red]An unexpected error occurred in the main loop:[/bold red]")
        console.print_exception(show_locals=False) # Print traceback
    finally:
        # Cleanup
        if gdbmi and gdbmi.gdb_process and gdbmi.gdb_process.poll() is None:
            console.print("Attempting to exit GDB cleanly...")
            try:
                 # Send exit command *without* waiting indefinitely if GDB is stuck
                 gdbmi.write("-gdb-exit", timeout_sec=2)
                 time.sleep(0.5) # Give GDB a moment to process exit
                 if gdbmi.gdb_process.poll() is None:
                     console.print("[yellow]GDB did not exit cleanly, terminating process...[/yellow]")
                     gdbmi.exit() # Force kill if still running
                 else:
                     console.print("[green]GDB exited.[/green]")
            except Exception as e:
                 console.print(f"[yellow]Warning:[/yellow] Error trying to exit GDB: {e}. Forcing termination.")
                 try:
                      gdbmi.exit() # Force kill on error too
                 except Exception: pass # Ignore errors during forced exit
        else:
            console.print("GDB process already terminated or not started.")

        console.print("Agent finished.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI-assisted GDB Debugger using Llama Stack")
    parser.add_argument("executable", help="Path to the C/C++ executable to debug (compiled with -g)")
    parser.add_argument("bug_description", help="Natural language description of the bug or crash")
    parser.add_argument("-m", "--model-id", help=f"Optional Llama Stack model ID (default: uses first available LLM or '{DEFAULT_MODEL_ID}' if found)", default=None)
    args = parser.parse_args()

    # Basic check for executable existence
    import os
    if not os.path.exists(args.executable):
        console.print(f"[red]Error:[/red] Executable path not found: {args.executable}")
        exit(1)
    if not os.access(args.executable, os.X_OK):
        console.print(f"[red]Error:[/red] Executable is not executable: {args.executable}")
        exit(1)


    main(args.executable, args.bug_description, args.model_id)