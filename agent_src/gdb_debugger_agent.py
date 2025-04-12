# gdb_debugger_agent.py

import argparse
import subprocess
import time
import uuid
import re
from typing import List, Dict, Any, Optional

from llama_stack_client import LlamaStackClient, Agent, AgentEventLogger
from llama_stack_client.types import Message, TurnEventPayloadCompleteTurn
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
The user will provide an initial bug description and the path to an executable.
You will interact with a GDB MI interface. In each turn, you will be shown the history of MI commands sent and the corresponding GDB MI output.
Based on the bug description and the GDB history, suggest the *single* next GDB MI command to execute.
Focus on commands that help diagnose crashes, inspect state, and step through execution.
Prioritize commands like: -exec-run, -exec-continue, -exec-next, -exec-step, -stack-list-frames, -stack-list-variables --simple 1, -data-evaluate-expression <var_name>, -break-insert <location>.
Format your response *only* as the GDB MI command itself, without any explanation or surrounding text.
Example response: `-exec-run`
Another example: `-break-insert main`
Another example: `-stack-list-frames`
If you believe the root cause is likely found or GDB has exited, respond with: `DONE`.
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
    # Simple extraction: Assume the LLM follows instructions and only returns the command.
    # More robust parsing could be added here (e.g., regex for common commands).
    if llm_response.startswith("-") or llm_response == "DONE":
         # Check if it looks like an MI command (starts with '-') or is DONE
        if llm_response == "DONE":
            return "DONE"
        # Basic sanity check for MI commands
        if re.match(r"^-[a-zA-Z0-9-]+", llm_response):
             return llm_response
    console.print(f"[yellow]Warning:[/yellow] LLM response doesn't look like a valid GDB MI command or DONE: '{llm_response}'")
    return None # Indicate an invalid or unexpected response

def format_gdb_output(gdb_responses: List[Dict[str, Any]]) -> str:
    """Formats the list of GDB MI responses into a readable string for the LLM."""
    formatted = []
    for response in gdb_responses:
        # Basic formatting, could be improved to be more structured/summarized
        formatted.append(f"  Type: {response.get('type', 'N/A')}, Payload: {response.get('payload', '{}')}")
    return "\n".join(formatted) if formatted else "  (No explicit GDB output)"

def is_gdb_terminated(gdb_responses: List[Dict[str, Any]]) -> bool:
    """Checks if GDB output indicates the program or GDB itself has terminated."""
    for response in gdb_responses:
        if response.get("type") == "notify" and response.get("message") == "thread-group-exited":
             return True
        if response.get("type") == "result" and response.get("message") == "exit": # GDB itself exited
            return True
        # Check for common stopped reasons indicating termination
        if response.get("type") == "notify" and response.get("class") == "stopped":
            payload = response.get("payload", {})
            reason = payload.get("reason")
            if reason in ["exited-normally", "exited", "signal-received"]: # Add more signals if needed
                 # Could refine signal-received to check specific signals like SIGSEGV later
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
        gdbmi = GdbController()
        console.print("[green]GDB MI Controller Initialized.[/green]")

        # Load the executable
        console.print(f"Loading executable '{executable_path}' into GDB...")
        response = gdbmi.write(f'-file-exec-and-symbols "{executable_path}"', timeout_sec=10)
        console.print(Syntax(format_gdb_output(response), "json", theme="default", line_numbers=False))
        # Basic check if loading failed (might need more robust error checking)
        if any(r.get("message") == "error" for r in response):
             console.print(f"[red]Error:[/red] Failed to load executable in GDB.")
             # print details
             for r in response:
                  if r.get("message") == "error":
                       console.print(f"  GDB Error Payload: {r.get('payload')}")
             return

        # 2. Initialize Llama Stack Client
        console.print(f"Connecting to Llama Stack server at {LLAMA_STACK_URL}...")
        client = LlamaStackClient(base_url=LLAMA_STACK_URL)
        # Verify connection (optional but good)
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

        while current_step < MAX_DEBUG_STEPS:
            current_step += 1
            console.print(Panel(f"Debugging Step {current_step}/{MAX_DEBUG_STEPS}", style="bold magenta"))

            # Prepare context for LLM
            prompt_context = f"Initial Bug Description: {bug_description}\n\n"
            prompt_context += "GDB MI Interaction History:\n"
            if not history:
                prompt_context += "(No commands executed yet)\n"
            else:
                for item in history:
                    prompt_context += f"-> Command: {item['command']}\n<- Output:\n{item['output']}\n"
            prompt_context += "\nSuggest the next GDB MI command:"

            messages = [Message(role="user", content=prompt_context)]

            # Get next command from LLM
            console.print("Querying LLM for next GDB command...")
            try:
                response_stream = agent.create_turn(
                    messages=messages,
                    session_id=session_id,
                    stream=True # Streaming usually preferred for observation
                )

                llm_response_content = ""
                # Use logger to print events and aggregate the final response
                logger = AgentEventLogger()
                final_turn_event: Optional[TurnEventPayloadCompleteTurn] = None
                for event in logger.log(response_stream):
                    event.print() # Print streaming events
                    if event.event.payload.event_type == "turn_complete":
                         final_turn_event = event.event.payload.turn


                if final_turn_event:
                    llm_response_content = final_turn_event.output_message.content.strip()
                    console.print(f"\n[bold cyan]LLM Suggested Command Raw:[/bold cyan] '{llm_response_content}'")
                else:
                     console.print("[red]Error:[/red] Did not receive turn_complete event from LLM.")
                     break # Exit loop if LLM fails

            except Exception as e:
                console.print(f"[red]Error during LLM interaction:[/red] {e}")
                break # Exit loop on LLM error

            # Parse and validate command
            gdb_command = extract_gdb_command(llm_response_content)

            if not gdb_command:
                console.print("[yellow]Could not extract a valid command from LLM. Stopping.[/yellow]")
                break

            if gdb_command == "DONE":
                console.print("[bold green]LLM indicated debugging is complete. Stopping.[/bold green]")
                break

            # Execute command in GDB
            console.print(f"Executing GDB command: [bold yellow]{gdb_command}[/bold yellow]")
            try:
                gdb_responses = gdbmi.write(gdb_command, timeout_sec=15) # Increased timeout for potentially long commands
                formatted_output = format_gdb_output(gdb_responses)
                console.print("GDB Output:")
                # Use Syntax highlighting if output resembles JSON/MI, otherwise print raw
                try:
                     # Attempt pretty printing structure if possible
                     import json
                     out_str = json.dumps([dict(r) for r in gdb_responses], indent=2) # Convert pygdbmi objects
                     console.print(Syntax(out_str, "json", theme="default", line_numbers=False, word_wrap=True))
                except Exception:
                      console.print(formatted_output) # Fallback to basic format

            except Exception as e:
                console.print(f"[red]Error executing GDB command '{gdb_command}':[/red] {e}")
                formatted_output = f"Error: {e}" # Store error as output
                # Decide whether to break or let the LLM try to recover
                console.print("[yellow]Trying to continue despite GDB error...[/yellow]")
                # break # Option: stop on GDB error

            # Record history
            history.append({"command": gdb_command, "output": formatted_output})

            # Check for GDB termination
            if is_gdb_terminated(gdb_responses):
                 console.print("[bold red]GDB process or target program appears to have terminated. Stopping.[/bold red]")
                 break

            # Small delay before next loop iteration (optional)
            # time.sleep(0.5)

        # End of loop
        if current_step >= MAX_DEBUG_STEPS:
            console.print(f"[yellow]Reached maximum debugging steps ({MAX_DEBUG_STEPS}). Stopping.[/yellow]")

        console.print(Panel("Debugging Session Summary", style="bold blue"))
        console.print(f"Initial Bug: {bug_description}")
        console.print(f"Executable: {executable_path}")
        console.print(f"Total Steps Taken: {current_step-1}") # -1 because last step didn't execute cmd
        console.print("Final State/History:")
        for i, item in enumerate(history):
             console.print(f" Step {i+1}:")
             console.print(f"  Command: {item['command']}")
             console.print(f"  Output: \n{item['output']}") # Rich handles multiline print
             console.print("-" * 20)


    except Exception as e:
        console.print(f"[bold red]An unexpected error occurred:[/bold red]")
        console.print_exception(show_locals=False) # Print traceback
    finally:
        # Cleanup
        if gdbmi:
            console.print("Exiting GDB...")
            try:
                 gdbmi.exit()
                 console.print("[green]GDB exited cleanly.[/green]")
            except Exception as e:
                 console.print(f"[yellow]Warning:[/yellow] Error trying to exit GDB: {e}")
        console.print("Agent finished.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI-assisted GDB Debugger using Llama Stack")
    parser.add_argument("executable", help="Path to the C/C++ executable to debug")
    parser.add_argument("bug_description", help="Natural language description of the bug or crash")
    parser.add_argument("-m", "--model-id", help=f"Optional Llama Stack model ID (default: {DEFAULT_MODEL_ID})", default=None)
    args = parser.parse_args()

    main(args.executable, args.bug_description, args.model_id)
