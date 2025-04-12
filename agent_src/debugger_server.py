from fastapi import FastAPI
from fastapi.responses import StreamingResponse, PlainTextResponse
import uvicorn
import asyncio
import sys
import threading
from pydantic import BaseModel
from typing import Optional
import json

# Import your existing main() from gdb_debugger_agent.py.
# Make sure that file is on your PYTHONPATH.
from gdb_debugger_agent import main

app = FastAPI(
    title="GDB Debugger Agent Streaming Server with Summary",
    description=(
        "A FastAPI server that streams debug session output from the GDB agent. "
        "The output is divided into a trace (everything before the delimiter) and a summary "
        "(everything after a line with '========================================')."
    ),
    version="1.0"
)

class DebugRequest(BaseModel):
    executable: str
    bug_description: str
    model_id: Optional[str] = None

# Global variables to store all agent output and a flag to signal completion.
agent_output = ""
agent_finished = False
output_lock = threading.Lock()

# A custom writer that pushes every write to an asyncio queue and appends to a global string.
class QueueWriter:
    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self.loop = loop
        self.queue = queue

    def write(self, text: str):
        global agent_output
        if text:
            with output_lock:
                agent_output += text
            # Schedule putting text into the queue safely from the background thread.
            asyncio.run_coroutine_threadsafe(self.queue.put(text), self.loop)

    def flush(self):
        pass

@app.post("/debug_target")
async def debug_target(request: DebugRequest):
    """
    Starts a debugging session and streams output as it’s produced.
    Only streams the trace portion (everything before the delimiter "========================================").
    """
    global agent_output, agent_finished
    # Reset globals for a new run.
    with output_lock:
        agent_output = ""
    agent_finished = False

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def run_agent():
        global agent_finished
        old_stdout = sys.stdout
        # Redirect stdout to our custom writer.
        sys.stdout = QueueWriter(loop, queue)
        try:
            # Execute the agent main routine.
            main(request.executable, request.bug_description, request.model_id)
        except Exception as e:
            asyncio.run_coroutine_threadsafe(queue.put(f"Error: {e}\n"), loop)
        finally:
            # When the agent is done, signal the end.
            asyncio.run_coroutine_threadsafe(queue.put("__END__"), loop)
            sys.stdout = old_stdout
            agent_finished = True

    # Run the agent in a separate thread so we can stream output concurrently.
    threading.Thread(target=run_agent).start()

    async def event_generator():
        """
        Async generator that yields JSON-formatted trace chunks until the delimiter is hit.
        Each yield is: {"type": "trace", "content": "..."}
        """
        while True:
            chunk = await queue.get()
            if chunk == "__END__":
                break
            if "========================================" in chunk:
                idx = chunk.find("========================================")
                trace_part = chunk[:idx]
                if trace_part.strip():
                    yield json.dumps({"type": "trace", "content": trace_part}) + "\n"
                break
            if chunk.strip():
                yield json.dumps({"type": "trace", "content": chunk}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/json")

@app.get("/get_summary")
async def get_summary():
    """
    Returns the summary of the debugging session, defined as the content between the first
    and second occurrence of the delimiter "========================================".
    Waits until the agent has finished.
    """
    global agent_output, agent_finished
    # Wait until the debugging session is complete.
    while not agent_finished:
        await asyncio.sleep(1)
    with output_lock:
        full_output = agent_output
    delimiter = "========================================"
    first_idx = full_output.find(delimiter)
    if first_idx == -1:
        return PlainTextResponse("No summary found. First delimiter not present.")
    second_idx = full_output.find(delimiter, first_idx + len(delimiter))
    if second_idx == -1:
        return PlainTextResponse("No summary found. Second delimiter not present.")
    
    # Extract content between the two delimiters.
    summary = full_output[first_idx + len(delimiter):second_idx].strip()
    return PlainTextResponse(summary)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
