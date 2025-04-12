from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import uvicorn
import asyncio
import sys
import threading
from pydantic import BaseModel
from typing import Optional

# Import your existing agent’s main() from gdb_debugger_agent.py.
# Make sure that file is on your PYTHONPATH.
from gdb_debugger_agent import main

app = FastAPI(
    title="GDB Debugger Agent Streaming Server",
    description="A FastAPI server that streams debug session output from the GDB agent.",
    version="1.0"
)

class DebugRequest(BaseModel):
    executable: str
    bug_description: str
    model_id: Optional[str] = None

# A custom writer that pushes every write to an asyncio queue
class QueueWriter:
    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self.loop = loop
        self.queue = queue

    def write(self, text: str):
        if text:
            # Schedule putting text into the queue safely from a background thread.
            asyncio.run_coroutine_threadsafe(self.queue.put(text), self.loop)

    def flush(self):
        # No-op for flush
        pass

@app.post("/debug_target")
async def debug_target(request: DebugRequest):
    """
    Starts a debugging session and streams output as it’s produced.
    The output is produced by your agent's main() method.
    """
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def run_agent():
        # Save and redirect stdout so that prints are intercepted.
        old_stdout = sys.stdout
        sys.stdout = QueueWriter(loop, queue)
        try:
            # Run the main agent routine.
            main(request.executable, request.bug_description, request.model_id)
        except Exception as e:
            # Push any exception message into the queue.
            asyncio.run_coroutine_threadsafe(queue.put(f"Error: {e}\n"), loop)
        finally:
            # Signal the end of the stream.
            asyncio.run_coroutine_threadsafe(queue.put("__END__"), loop)
            sys.stdout = old_stdout

    # Run the agent in a separate thread so we can stream output concurrently.
    threading.Thread(target=run_agent).start()

    # Async generator that yields output chunks from the agent.
    async def event_generator():
        while True:
            chunk = await queue.get()
            if chunk == "__END__":
                break
            yield chunk

    return StreamingResponse(event_generator(), media_type="text/plain")

if __name__ == "__main__":
    # Run the FastAPI app on port 8000.
    uvicorn.run(app, host="0.0.0.0", port=8000)
