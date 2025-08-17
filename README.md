# GDBuddy (1st Place - Austin 8VC/Meta Llama Stack Hacakthon)

A FastAPI server that integrates with a VS Code extension to provide AI-assisted debugging for C code using GDB and an LLM. This solution streams live trace output and later serves a summary of the debugging session—all without having to wait for the full session to complete.

## Overview

This project implements a debugging workflow that combines several technologies:

- **GDB & Python Agent:**  
  A Python script (originally in `gdb_debugger_agent.py`) launches GDB with the Machine Interface (MI) to run your C executable and capture its output.

- **LLM Integration:**  
  An integrated language model (via Llama Stack, for example) analyzes the GDB output, determines the next debugging step, and provides the appropriate GDB command.

- **FastAPI Streaming Server:**  
  The FastAPI server (in this project) provides two endpoints:
  - **`/debug_target` (POST):**  
    Launches a debugging session and streams the trace output (i.e. everything printed before a delimiter).
  - **`/get_summary` (GET):**  
    Once the session ends, returns the summary—i.e. the content between two delimiters.

- **VS Code Extension Integration:**  
  A VS Code extension calls these endpoints to receive real-time feedback and summaries, thereby assisting you in debugging C code quickly.

## Features

- **Real-Time Streaming:**  
  Uses HTTP chunked transfer encoding with FastAPI’s `StreamingResponse` to stream trace logs as they are produced by the agent.

- **Summary Extraction:**  
  Separates detailed trace output (live debugging logs) from a post-execution summary using a custom delimiter.

- **Seamless Integration:**  
  Designed to work in conjunction with a VS Code extension that sends debugging requests and displays streamed responses.

## Architecture

1. **Agent Execution:**  
   The agent’s main routine is executed in a background thread. Standard output (`sys.stdout`) is redirected to a custom writer that both collects the output in a global buffer and pushes every text chunk to an asyncio queue.

2. **Streaming Endpoint:**  
   The `/debug_target` endpoint starts the debugging session. An async generator yields output chunks until the first delimiter is detected, sending only the trace.

3. **Summary Endpoint:**  
   The `/get_summary` endpoint waits until the agent has completed and then parses the global output. It extracts and returns only the portion between the first and second occurrence of the delimiter.

## Requirements

- **Python 3.8+**
- **GDB**

The following are in the requirements.txt:
```
llama-stack-client
llama-stack
pygdbmi
rich
fastapi
uvicorn
pydantic
```

## Installation

1. Clone this repository:
   ```bash
   git clone <repository_url>
   cd <repository_directory>
   ```

2. Install Python dependencies from the `agent_src` directory:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

### Running the Server

Run the FastAPI server from the `agent_src` directory:
```bash
python3 debugging_agent.py
```
This will start the debugging backend on port 8000.

### Endpoints

#### 1. POST `/debug_target`

Starts a debugging session and streams live trace output until the delimiter appears.

**Example using curl:**
```bash
curl --no-buffer -X POST "http://localhost:8000/debug_target" \
     -H "Content-Type: application/json" \
     -d '{"executable": "test_executables/test_1", "bug_description": "This is segfaulting, help"}'
```

The trace output (everything before the delimiter) will stream back to the client.

#### 2. GET `/get_summary`

Returns the summary of the debugging session; that is, the content between the first and second occurrence of the delimiter.

**Example using curl:**
```bash
curl "http://localhost:8000/get_summary"
```

### VS Code Extension Integration

Our VS Code extension can call these endpoints:
- Use `/debug_target` for real-time trace information.
- Use `/get_summary` to display a concise summary after the session.

## Customization

- **Delimiters:**  
  The agent output is split using the delimiter string `========================================`. Modify this string in both the agent code and the endpoints if needed.
- **Output Redirection:**  
  The custom `QueueWriter` class ensures that all printed output is captured and pushed to both a global buffer and an asyncio queue.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests to improve:
- The integration between the GDB agent and FastAPI.
- Additional parsing and formatting of output.
- VS Code extension compatibility and user experience.

## License

MIT
