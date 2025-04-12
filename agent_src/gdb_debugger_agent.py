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
# from llama_stack.distribution.library_client import LlamaStackAsLibraryClient # Commented out as it wasn't fully integrated and requires setup
from llama_stack.distribution.library_client import LlamaStackAsLibraryClient

import litellm

# Other Imports
from pygdbmi.gdbcontroller import GdbController
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax

litellm.suppress_debug_info = True

# --- Configuration ---
LLAMA_STACK_URL = "http://localhost:8321"
# Make sure this model is available on your Llama Stack server (local or via provider)
DEFAULT_MODEL_ID = "groq/llama-3.1-8b-instant"
MAX_DEBUG_STEPS = 15 # Limit the number of interactions
LOOP_DELAY_SECONDS = 5 # Delay between LLM calls to avoid rate limiting

AGENT_INSTRUCTIONS = """
You are an expert C/C++ debugger using GDB's Machine Interface (MI).
Your goal is to help the user find the root cause of a bug in their program.
The user will provide an initial bug description and the path to an executable compiled with debug symbols (-g).
You will interact with a GDB MI interface. In each turn, you will be shown the history of MI commands sent and the corresponding GDB MI output summary.
Based on the bug description and the GDB history, suggest the *single* next GDB MI command to execute.
Focus on commands that help diagnose crashes, inspect state, and step through execution.
Prioritize commands like: -exec-run, -exec-continue, -exec-next, -exec-step, -stack-list-frames, -stack-select-frame <frame_num>, -stack-list-variables --simple 1, -data-evaluate-expression <var_name>, -break-insert <location>, -break-delete <bp_num>, -exec-interrupt.
Ensure the location for -break-insert is valid (e.g., function name, file:line_number).
Format your response *only* as the GDB MI command itself, without any explanation or surrounding text.
Example response: `-exec-run`
Another example: `-break-insert main`
Another example: `-stack-list-frames`
If you believe the root cause is likely found (e.g., after identifying a crash location via -stack-list-frames and inspecting relevant variables) or GDB has exited, respond *only* with the word: `DONE`.
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

    # Check if it matches a GDB MI command pattern
    # Allows optional arguments after the command itself
    if re.match(r"^-[a-zA-Z0-9-]+(\s+.*)?$", llm_response):
        return llm_response

    # More detailed debugging for non-matching responses
    if llm_response.startswith('-'):
        console.print(f"[yellow]Warning:[/yellow] Command starts with '-' but doesn't match expected MI pattern: '{llm_response}'")
    else:
        console.print(f"[yellow]Warning:[/yellow] LLM response doesn't look like a valid GDB MI command or DONE: '{llm_response}'")

    return None # Indicate an invalid or unexpected response

def format_gdb_output_for_llm(gdb_responses: List[Dict[str, Any]]) -> str:
    """Formats the list of GDB MI responses into a concise string for the LLM."""
    formatted = []
    # Limit the number of responses summarized to avoid excessive length
    max_responses_to_summarize = 10
    responses_to_process = gdb_responses[-max_responses_to_summarize:] # Take last N

    for response in responses_to_process:
        res_type = response.get('type', 'N/A')
        res_class = response.get('class', '')
        res_msg = response.get('message', '') # GDB's short status message
        payload = response.get('payload', {})

        summary = f"  Type: {res_type}"
        if res_class: summary += f", Class: {res_class}"
        if res_msg: summary += f", Msg: {res_msg}"

        # Add selective payload info (avoid excessive verbosity)
        if payload:
            if isinstance(payload, dict):
                 # Show keys or specific important keys like 'frame', 'reason'
                 payload_keys = list(payload.keys())
                 payload_summary = str(payload_keys)
                 if 'frame' in payload:
                     frame = payload['frame']
                     func = frame.get('func', '?')
                     file = frame.get('file', '?')
                     line = frame.get('line', '?')
                     payload_summary += f" (Frame: {func} at {file}:{line})"
                 elif 'reason' in payload:
                      payload_summary += f" (Reason: {payload['reason']})"

                 if len(payload_summary) > 150: payload_summary = payload_summary[:150] + "..."
                 summary += f", PayloadInfo: {payload_summary}"
            elif isinstance(payload, str):
                 payload_summary = payload
                 if len(payload_summary) > 100: payload_summary = payload_summary[:100] + "..."
                 summary += f", Payload: {payload_summary}"
        formatted.append(summary)

    if len(gdb_responses) > max_responses_to_summarize:
        formatted.append(f"  (...truncated {len(gdb_responses) - max_responses_to_summarize} older responses...)")

    return "\n".join(formatted) if formatted else "  (No explicit GDB output)"

def print_gdb_output_human(gdb_responses: List[Dict[str, Any]]):
    """Prints GDB output in a more human-readable format using Rich."""
    if not gdb_responses:
        console.print("[grey50]No GDB output received.[/grey50]")
        return
    try:
        # Convert pygdbmi MixedDict objects to plain dicts for json serialization
        plain_dicts = [dict(r) for r in gdb_responses]
        out_str = json.dumps(plain_dicts, indent=2)
        console.print(Syntax(out_str, "json", theme="default", line_numbers=False, word_wrap=True))
    except Exception as e:
        console.print(f"[yellow]Could not format GDB output as JSON ({e}), printing raw:[/yellow]")
        for response in gdb_responses:
             console.print(response) # Fallback to raw printing

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
        if response.get("type") == "result" and response.get("class") == "exit": # Check class=exit
            console.print("[bold yellow]Detected GDB 'exit' result[/bold yellow]")
            return True
        # Program stopped for a reason indicating termination
        if response.get("type") == "notify" and response.get("class") == "stopped":
            payload = response.get("payload", {})
            reason = payload.get("reason")
            # Only consider "exited-normally" or "exited" as true termination for this check.
            # Crashes (signals) should be handled by the LLM.
            if reason in ["exited-normally", "exited"]:
                 console.print(f"[bold yellow]Detected stopped reason indicating termination:[/bold yellow] {reason}")
                 return True
    return False

# --- Main Agent Logic ---

def main(executable_path: str, bug_description: str, model_id: Optional[str]):
    console.print(Panel(f"Starting GDB Debugger Agent\nExecutable: {executable_path}\nBug: {bug_description}", title="Setup", style="bold blue"))

    gdbmi: Optional[GdbController] = None
    client: Optional[LlamaStackClient] = None
    agent: Optional[Agent] = None # Define agent here for final summary access

    try:
        # 1. Initialize GDB Controller
        console.print("Starting GDB...")
        # Use mi2 interpreter for better compatibility with pygdbmi parsing
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
        # Default client connecting to the server URL
        client = LlamaStackAsLibraryClient(
            "groq",)
        client.initialize()

        # 3. Setup Agent
        selected_model_id = find_llm_model(client, model_id or DEFAULT_MODEL_ID)
        agent = Agent(client, model=selected_model_id, instructions=AGENT_INSTRUCTIONS)
        session_id = agent.create_session(session_name=f"gdb-debug-{uuid.uuid4().hex}")
        console.print(f"Created agent session: {session_id}")

        # 4. Debugging Loop
        history: List[Dict[str, Any]] = [] # Store more than just strings now
        current_step = 0
        gdb_alive = True
        last_gdb_command = "N/A" # Keep track for final status message

        while current_step < MAX_DEBUG_STEPS and gdb_alive:
            current_step += 1
            console.print(Panel(f"Debugging Step {current_step}/{MAX_DEBUG_STEPS}", style="bold magenta"))

            # Prepare context for LLM
            prompt_context = f"Initial Bug Description: {bug_description}\n\n"
            prompt_context += "GDB MI Interaction History (Summarized - Last 5 Steps):\n"
            if not history:
                prompt_context += "(No commands executed yet. Executable is loaded.)\n"
            else:
                start_index = max(0, len(history) - 5) # Show last 5 summaries
                for i, item in enumerate(history[start_index:], start=start_index):
                    prompt_context += f"Step {i+1}:\n-> Command: {item['command']}\n<- Output Summary:\n{item['output_summary']}\n"
            prompt_context += "\nSuggest the *single* next GDB MI command (or DONE):"

            messages = [{"role": "user", "content": prompt_context}]

            # Get next command from LLM
            console.print("Querying LLM for next GDB command...")
            llm_response_content = ""
            final_turn: Optional[Turn] = None
            try:
                response_stream = agent.create_turn(
                    messages=messages,
                    session_id=session_id,
                    stream=True # Use streaming for responsiveness
                )

                stream_text = ""
                # Process the stream to get delta and final turn
                for stream_chunk in response_stream:
                    payload = stream_chunk.event.payload
                    if payload.event_type == "turn_delta":
                         if hasattr(payload, 'text') and payload.text:
                            stream_text += payload.text
                            # Print delta text live for user feedback
                            print(payload.text, end="", flush=True)

                    elif payload.event_type == "turn_complete":
                         final_turn = payload.turn
                         break # Stop processing stream once complete turn is found

                print() # Ensure newline after streaming output finishes

                if final_turn:
                    # Extract content from the final turn object
                    if isinstance(final_turn.output_message.content, str):
                        llm_response_content = final_turn.output_message.content.strip()
                        console.print(f"[bold cyan]LLM Suggested Raw:[/bold cyan] '{llm_response_content}'")
                    else:
                        console.print("[red]Error:[/red] LLM response content is not a simple string.")
                        llm_response_content = "" # Force empty if format is unexpected
                else:
                     # This case might occur if the stream ends without a 'turn_complete' event
                     # Potentially use the aggregated stream_text if available
                     if stream_text:
                          console.print("[yellow]Warning:[/yellow] Stream finished without explicit 'turn_complete', using aggregated text.")
                          llm_response_content = stream_text.strip()
                          console.print(f"[bold cyan]LLM Suggested Raw (from stream):[/bold cyan] '{llm_response_content}'")
                     else:
                          console.print("\n[red]Error:[/red] Did not receive turn_complete event or any stream content from LLM.")
                          break # Exit loop if LLM provides no usable response

            except Exception as e:
                console.print(f"\n[red]Error during LLM interaction:[/red] {e}")
                break # Exit loop on LLM error

            # Parse and validate command
            gdb_command = extract_gdb_command(llm_response_content)
            last_gdb_command = gdb_command or "Invalid Command" # Update last command attempt

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
                # GDB MI requires tokens to be integers for responses
                cmd_token_val = current_step + 1 # Use a simple incrementing integer token
                gdb_responses = gdbmi.write(f"{cmd_token_val}{gdb_command}", timeout_sec=20) # Increased timeout
                console.print("GDB Output:")
                print_gdb_output_human(gdb_responses)

                # Correctly check token AND class for error
                cmd_error = any(r.get("token") == cmd_token_val and r.get("type") == "result" and r.get("class") == "error" for r in gdb_responses)
                if cmd_error:
                    console.print(f"[red]GDB Error occurred for command '{gdb_command}'. See output above.[/red]")
                    # Optionally extract and print the error message here too
                    for r in gdb_responses:
                         if r.get("token") == cmd_token_val and r.get("type") == "result" and r.get("class") == "error":
                              error_msg = r.get('payload', {}).get('msg', 'Unknown GDB error')
                              console.print(f"  GDB Error Details: {error_msg}")

            except Exception as e:
                # This usually means GDB crashed or the connection died
                console.print(f"[bold red]FATAL:[/bold red] Error communicating with GDB: {e}")
                console.print("Assuming GDB has terminated.")
                gdb_alive = False
                formatted_output_summary = f"Error communicating with GDB: {e}"
                gdb_responses = [] # Ensure it's an empty list

            # Format and store history *after* execution attempt
            # Ensure gdb_responses is a list even if communication failed
            formatted_output_summary = format_gdb_output_for_llm(gdb_responses or [])
            history.append({
                "command": gdb_command,
                "output_summary": formatted_output_summary,
                # Store serializable output for potential final summary
                "full_output": [dict(r) for r in (gdb_responses or [])]
                })

            # Check for termination based on output
            if gdb_alive and is_gdb_terminated(gdb_responses or []):
                 console.print("[bold red]GDB process or target program appears to have terminated based on output. Stopping.[/bold red]")
                 gdb_alive = False

            # <<< ADD DELAY HERE >>>
            if gdb_alive and LOOP_DELAY_SECONDS > 0: # Only sleep if we might loop again and delay is set
                console.print(f"[grey50]Pausing for {LOOP_DELAY_SECONDS} second(s)...[/grey50]")
                time.sleep(LOOP_DELAY_SECONDS)

        # --- End of Debugging Loop ---

        final_summary = "Summary could not be generated."
        # Attempt to get final summary from LLM if loop didn't end due to critical error
        if agent and history: # Check if agent was initialized and we have history
            console.print(Panel("Generating Final Summary via LLM", style="bold blue"))
            summary_prompt = f"Initial Bug Description: {bug_description}\n\n"
            summary_prompt += "Based on the following GDB MI interaction history, please provide a concise summary.\n"
            summary_prompt += "Identify the likely root cause of the bug, the specific location (file:line or function if possible), and suggest a potential fix.\n\n"
            summary_prompt += "History:\n"
            # Include summarized history in the prompt
            for i, item in enumerate(history):
                 summary_prompt += f"Step {i+1}:\n-> Command: {item['command']}\n<- Output Summary:\n{item['output_summary']}\n"
            summary_prompt += "\nProvide only the summary description:"

            summary_messages = [{"role": "user", "content": summary_prompt}]

            try:
                 # Use non-streaming for the final summary call for simplicity
                 summary_response_turn: Turn = agent.create_turn(
                     messages=summary_messages,
                     session_id=session_id, # Can reuse the session or create a new one
                     stream=False
                 )
                 if isinstance(summary_response_turn.output_message.content, str):
                     final_summary = summary_response_turn.output_message.content.strip()
                 else:
                     final_summary = "[Summary received in unexpected format]"
                 console.print("[green]Summary generated.[/green]")
            except Exception as e:
                 console.print(f"[red]Error generating final summary from LLM:[/red] {e}")
                 final_summary = "[Error occurred during summary generation]"
        elif not history:
             final_summary = "[No debugging steps taken, cannot generate summary]"


        # Print final summary panel
        console.print(Panel("Debugging Session Summary", style="bold blue"))
        console.print(f"Initial Bug: {bug_description}")
        console.print(f"Executable: {executable_path}")
        console.print(f"Total Steps Attempted: {current_step}")

        final_status = "Unknown"
        if not gdb_alive: final_status = "GDB Terminated or Communication Lost"
        elif last_gdb_command == "DONE": final_status = "LLM Stopped (DONE)"
        elif current_step >= MAX_DEBUG_STEPS: final_status = "Max Steps Reached"
        console.print(f"Final Status: {final_status}")

        # Print the generated summary
        console.print(Panel(final_summary, title="LLM Summary of Findings", style="green", border_style="green"))

        # Print history for user reference (optional)
        # console.print("Interaction History (Summarized):")
        # if history:
        #     for i, item in enumerate(history):
        #         console.print(f" Step {i+1}:")
        #         console.print(f"  Command: {item['command']}")
        #         console.print(f"  Output Summary: \n{item['output_summary']}")
        #         console.print("-" * 20)
        # else:
        #      console.print("(No commands were executed)")


    except Exception as e:
        console.print(f"[bold red]An unexpected error occurred in the main function:[/bold red]")
        console.print_exception(show_locals=False) # Print traceback for unexpected errors
    finally:
        # Cleanup GDB process
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
    parser.add_argument("--delay", type=float, default=LOOP_DELAY_SECONDS, help=f"Delay in seconds between LLM calls (default: {LOOP_DELAY_SECONDS})")

    args = parser.parse_args()

    # Update global delay based on args
    LOOP_DELAY_SECONDS = args.delay

    # Basic checks for executable
    if not os.path.exists(args.executable):
        console.print(f"[red]Error:[/red] Executable path not found: {args.executable}")
        exit(1)
    if not os.access(args.executable, os.X_OK):
        console.print(f"[red]Error:[/red] Executable is not executable: {args.executable}")
        exit(1)

    main(args.executable, args.bug_description, args.model_id)