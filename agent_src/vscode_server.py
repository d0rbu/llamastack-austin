from fastapi import FastAPI, Request
from pydantic import BaseModel
from typing import List, Optional
import asyncio
import io
import sys
from agent import main as agent_main  # Reference only, not rewriting

app = FastAPI()

# Capture stdout
class OutputBuffer(io.StringIO):
    def __init__(self):
        super().__init__()
        self.output = []

    def write(self, s):
        self.output.append(s)
        super().write(s)

    def get_output(self):
        return ''.join(self.output)

class DebugRequest(BaseModel):
    history: List[str]
    bug: str
    max_steps: Optional[int] = 15

@app.post("/debug")
async def debug(request: DebugRequest):
    buf = OutputBuffer()
    old_stdout = sys.stdout
    sys.stdout = buf

    try:
        await agent_main(request.history, request.bug, request.max_steps)
    except Exception as e:
        sys.stdout = old_stdout
        return {"error": str(e)}
    finally:
        sys.stdout = old_stdout

    return {"output": buf.get_output()}
