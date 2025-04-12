import argparse
import subprocess
import time
import uuid
import re
import json # Import json for pretty printing GDB output
import os # For path checks
from typing import List, Dict, Any, Optional

# Llama Stack Imports
from llama_stack_client import LlamaStackClient, Agent, AgentEventLogger
from llama_stack_client.types.agents import Turn # Correct import for the Turn object

# Other Imports
from pygdbmi.gdbcontroller import GdbController
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax

# --- Configuration ---
LLAMA_STACK_URL = "http://localhost:8321"
DEFAULT_MODEL_ID = "meta-llama/Meta-Llama-3-8B-Instruct" # Example - REPLACE if needed
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

        if preferred_model_id:
            for m in llm_models:
                if m.identifier == preferred_model_id:
                    console.print(f"[green]Using preferred model:[/green] {preferred_model_id}")
                    return m.identifier
            console.print(f"[yellow]Warning:[/yellow] Preferred model '{preferred_model_id}' not found. Selecting another LLM.")

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
    if llm_response == "DONE":
        return "DONE"
    if re.match(r"^-[a-zA-Z0-9-]+(\s+.*)?$", llm_response):
         return llm_response
    console.print(f"[yellow]Warning:[/yellow] LLM response doesn't look like a valid GDB MI command or DONE: '{llm_response}'")
    return None

def format_gdb_output_for_llm(gdb_responses: List[Dict[str, Any]]) -> str:
    """Formats the list of GDB MI responses into a concise string for the LLM."""
    formatted = []
    for response in gdb_responses:
        res_type = response.get('type', 'N/A')
        res_class = response.get('class', '')
        res_msg = response.get('message', '')
        payload = response.get('payload', {})

        summary = f"  Type: {res_type}"
        if res_class: summary += f", Class: {res_class}"
        if res_msg: summary += f", Msg: {res_msg}"
        if payload:
            if isinstance(payload, dict):
                 payload_summary = str(list(payload.keys()))
                 if len(payload_summary) > 100: payload_summary = payload_summary[:100] + "..."
                 summary += f", PayloadKeys: {payload_summary}"
            elif isinstance(payload, str):
                 payload_summary = payload
                 if len(payload_summary) > 100: payload_summary = payload_summary[:100] + "..."
                 summary += f", Payload: {payload_summary}"
        formatted.append(summary)
    return "\n".join(formatted) if formatted else "  (No explicit GDB output)"

def print_gdb_output_human(gdb_responses: List[Dict[str, Any]]):
    """Prints GDB output in a more human-readable format using Rich."""
    if not gdb_responses:
        console.print("[grey50]No GDB output received.[/grey50]")
        return
    try:
        plain_dicts = [dict(r) for r in gdb_responses]
        out_str = json.dumps(plain_dicts, indent=2)
        console.print(Syntax(out_str, "json", theme="default", line_numbers=False, word_wrap=True))
    except Exception as e:
        console.print(f"[yellow]Could not format GDB output as JSON ({e}), printing raw:[/yellow]")
        for response in gdb_responses:
             console.print(response)

def is_gdb_terminated(gdb_responses: List[Dict[str, Any]]) -> bool:
    """Checks if GDB output indicates the program or GDB itself has terminated."""
    if not gdb_responses:
        return True
    for response in gdb_responses:
        if response.get("type") == "notify" and response.get("message") == "thread-group-exited":
             console.print("[bold yellow]Detected 'thread-group-exited'[/bold yellow]")
             return True
        if response.get("type") == "result" and response.get("message") == "exit":
            console.print("[bold yellow]Detected GDB 'exit' result[/bold yellow]")
            return True
        if response.get("type") == "notify" and response.get("class") == "stopped":
            payload = response.get("payload", {})
            reason = payload.get("reason")
            if reason in ["exited-normally", "exited"]:
                 console.print(f"[bold yellow]Detected stopped reason:[/bold yellow] {reason}")
                 return True
    return False

# --- Main Agent Logic ---

def main(executable_path: str, bug_description: str, model_id: Optional[str]):
    console.print(Panel(f"Starting GDB Debugger Agent\nExecutable: {executable_path}\nBug: {bug_description}", title="Setup", style="bold blue"))

    gdbmi: Optional[GdbController] = None
    client: Optional[LlamaStackClient] = None

    try:
        # 1. Initialize GDB Controller
        console.print("Starting GDB...")
        gdbmi = GdbController(command=['gdb', '--nx', '--quiet', '--interpreter=mi2'])
        console.print("[green]GDB MI Controller Initialized.[/green]")

        # Load the executable
        console.print(f"Loading executable '{executable_path}' into GDB...")
        load_token = "load-exec"
        response = gdbmi.write(f'1-file-exec-and-symbols "{executable_path}"', timeout_sec=10)

        print_gdb_output_human(response)
        load_successful = any(r.get("token") == 1 and r.get("type") == "result" and r.get("message") == "done" for r in response)
        
        if not load_successful:
            console.print(f"[red]Error:[/red] Failed to load executable in GDB. Check GDB output above.")
            for r in response:
                if r.get("type") == "result" and r.get("message") == "error":
                    console.print(f"  GDB Error Payload: {r.get('payload', {}).get('msg', 'Unknown error')}")
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
        history: List[Dict[str, Any]] = [] # Store more than just strings now
        current_step = 0
        gdb_alive = True

        while current_step < MAX_DEBUG_STEPS and gdb_alive:
            current_step += 1
            console.print(Panel(f"Debugging Step {current_step}/{MAX_DEBUG_STEPS}", style="bold magenta"))

            # Prepare context for LLM
            prompt_context = f"Initial Bug Description: {bug_description}\n\n"
            prompt_context += "GDB MI Interaction History (Last 5 Steps):\n"
            if not history:
                prompt_context += "(No commands executed yet. Executable is loaded.)\n"
            else:
                start_index = max(0, len(history) - 5) # Show last 5
                for i, item in enumerate(history[start_index:], start=start_index):
                    prompt_context += f"Step {i+1}:\n-> Command: {item['command']}\n<- Output Summary:\n{item['output_summary']}\n"
            prompt_context += "\nSuggest the *single* next GDB MI command (or DONE):"

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

                final_turn: Optional[Turn] = None
                logger = AgentEventLogger() # Can still use for detailed logging if enabled

                stream_text = ""
                for stream_chunk in response_stream:
                    # logger.log_event(stream_chunk) # Optionally log every event
                    payload = stream_chunk.event.payload
                    if payload.event_type == "turn_delta":
                         if hasattr(payload, 'text') and payload.text:
                            stream_text += payload.text
                            print(payload.text, end="", flush=True) # Live output

                    if payload.event_type == "turn_complete":
                         final_turn = payload.turn
                         break

                print() # Newline after streaming completes

                if final_turn:
                    if isinstance(final_turn.output_message.content, str):
                        llm_response_content = final_turn.output_message.content.strip()
                        # If streaming didn't capture full response (e.g., if only last chunk had content)
                        if not stream_text and llm_response_content:
                             console.print(f"[grey50](LLM full response: '{llm_response_content}')[/grey50]")
                        elif stream_text != llm_response_content:
                             console.print(f"[grey50](LLM final content differs slightly: '{llm_response_content}')[/grey50]")

                        console.print(f"[bold cyan]LLM Suggested Raw:[/bold cyan] '{llm_response_content}'")
                    else:
                        console.print("[red]Error:[/red] LLM response content is not a simple string.")
                        llm_response_content = ""
                else:
                     console.print("\n[red]Error:[/red] Did not receive turn_complete event or final Turn object from LLM stream.")
                     break

            except Exception as e:
                console.print(f"\n[red]Error during LLM interaction:[/red] {e}")
                break

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
                cmd_token = f"cmd-{current_step}"
                gdb_responses = gdbmi.write(f"{cmd_token}{gdb_command}", timeout_sec=20)
                console.print("GDB Output:")
                print_gdb_output_human(gdb_responses)
                cmd_error = any(r.get("token") == cmd_token and r.get("type") == "result" and r.get("class") == "error" for r in gdb_responses)
                if cmd_error:
                    console.print(f"[red]GDB Error occurred for command '{gdb_command}'. See output above.[/red]")

            except Exception as e:
                console.print(f"[bold red]FATAL:[/bold red] Error communicating with GDB: {e}")
                console.print("Assuming GDB has terminated.")
                gdb_alive = False
                formatted_output_summary = f"Error communicating with GDB: {e}"
                gdb_responses = []

            # Format and store history *after* execution attempt
            formatted_output_summary = format_gdb_output_for_llm(gdb_responses)
            history.append({
                "command": gdb_command,
                "output_summary": formatted_output_summary,
                "full_output": [dict(r) for r in gdb_responses] # Store serializable output
                })

            # Check for termination based on output
            if gdb_alive and is_gdb_terminated(gdb_responses):
                 console.print("[bold red]GDB process or target program appears to have terminated based on output. Stopping.[/bold red]")
                 gdb_alive = False

        # End of loop
        if current_step >= MAX_DEBUG_STEPS:
            console.print(f"[yellow]Reached maximum debugging steps ({MAX_DEBUG_STEPS}). Stopping.[/yellow]")

        console.print(Panel("Debugging Session Summary", style="bold blue"))
        console.print(f"Initial Bug: {bug_description}")
        console.print(f"Executable: {executable_path}")
        console.print(f"Total Steps Attempted: {current_step}")
        final_status = "Unknown"
        if not gdb_alive: final_status = "GDB Terminated"
        elif gdb_command == "DONE": final_status = "LLM Stopped (DONE)"
        elif current_step >= MAX_DEBUG_STEPS: final_status = "Max Steps Reached"
        console.print(f"Final Status: {final_status}")

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
        console.print_exception(show_locals=False)
    finally:
        # Cleanup
        if gdbmi and gdbmi.gdb_process and gdbmi.gdb_process.poll() is None:
            console.print("Attempting to exit GDB cleanly...")
            try:
                 gdbmi.write("-gdb-exit", timeout_sec=2)
                 time.sleep(0.5)
                 if gdbmi.gdb_process.poll() is None:
                     console.print("[yellow]GDB did not exit cleanly, terminating process...[/yellow]")
                     gdbmi.exit()
                 else:
                     console.print("[green]GDB exited.[/green]")
            except Exception as e:
                 console.print(f"[yellow]Warning:[/yellow] Error trying to exit GDB: {e}. Forcing termination.")
                 try: gdbmi.exit()
                 except Exception: pass
        else:
            console.print("GDB process already terminated or not started.")
        console.print("Agent finished.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI-assisted GDB Debugger using Llama Stack")
    parser.add_argument("executable", help="Path to the C/C++ executable to debug (compiled with -g)")
    parser.add_argument("bug_description", help="Natural language description of the bug or crash")
    parser.add_argument("-m", "--model-id", help=f"Optional Llama Stack model ID (default: uses first available LLM or '{DEFAULT_MODEL_ID}' if found)", default=None)
    args = parser.parse_args()

    if not os.path.exists(args.executable):
        console.print(f"[red]Error:[/red] Executable path not found: {args.executable}")
        exit(1)
    if not os.access(args.executable, os.X_OK):
        console.print(f"[red]Error:[/red] Executable is not executable: {args.executable}")
        exit(1)

    main(args.executable, args.bug_description, args.model_id)