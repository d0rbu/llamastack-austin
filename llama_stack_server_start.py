#!/usr/bin/env python3
"""
Llama Stack Server Runner

This script provides a simple way to run a Llama Stack server locally with
Llama or Gemma models. It handles installing dependencies, starting the server,
and provides a simple interface for interacting with it.
"""
import os
import sys
import subprocess
import time
import argparse
import requests
from requests.exceptions import ConnectionError
import signal
import atexit
import json
import webbrowser
from typing import Optional

# Global variables
server_process = None
server_log_file = None
DEFAULT_MODELS = {
    "llama3": "meta-llama/Meta-Llama-3-8B-Instruct",
    "llama3-70b": "meta-llama/Meta-Llama-3-70B-Instruct",
    "llama2": "meta-llama/Llama-2-7b-chat-hf",
    "llama2-13b": "meta-llama/Llama-2-13b-chat-hf",
    "llama2-70b": "meta-llama/Llama-2-70b-chat-hf",
    "gemma": "google/gemma-7b-it",
    "gemma-2b": "google/gemma-2b-it"
}

def check_dependencies():
    """Check if uv is installed and install it if not."""
    try:
        subprocess.run(["uv", "--version"], capture_output=True, check=True)
        print("✓ UV is installed")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("UV not found. Installing UV...")
        try:
            # Install uv using the recommended method
            subprocess.run(
                "curl -sSf https://raw.githubusercontent.com/astral-sh/uv/main/install.sh | sh",
                shell=True, check=True
            )
            print("✓ UV installed successfully")
        except subprocess.CalledProcessError:
            print("Failed to install UV. Please install it manually:")
            print("curl -sSf https://raw.githubusercontent.com/astral-sh/uv/main/install.sh | sh")
            sys.exit(1)

def install_dependencies():
    """Install required Python dependencies."""
    print("Installing required dependencies...")
    
    # Ensure UV_SYSTEM_PYTHON is not set to avoid conflicts
    if "UV_SYSTEM_PYTHON" in os.environ:
        del os.environ["UV_SYSTEM_PYTHON"]
    
    # Install requests for API calls
    subprocess.run(["uv", "pip", "install", "requests"], check=True)
    
    # Install llama-stack and build the meta-reference-gpu template
    print("Setting up llama-stack (this may take several minutes)...")
    subprocess.run(
        "uv run --with llama-stack llama stack build --template meta-reference-gpu --image-type venv",
        shell=True, check=True
    )
    print("✓ Dependencies installed successfully")

def list_available_models():
    """List all available model shortcuts and their corresponding HF model IDs."""
    print("\nAvailable model shortcuts:")
    print("-" * 60)
    print(f"{'Shortcut':<12} {'Model ID':<48}")
    print("-" * 60)
    for shortcut, model_id in DEFAULT_MODELS.items():
        print(f"{shortcut:<12} {model_id:<48}")
    print("-" * 60)
    print("You can also specify a full Hugging Face model ID directly.\n")

def run_llama_stack_server(model_id: str):
    """
    Start the Llama Stack server with the specified model.
    
    Args:
        model_id: Either a model shortcut or full Hugging Face model ID.
    
    Returns:
        The subprocess.Popen object representing the server process.
    """
    global server_process, server_log_file
    
    # Resolve model shortcut if provided
    if model_id in DEFAULT_MODELS:
        full_model_id = DEFAULT_MODELS[model_id]
        print(f"Using model: {model_id} ({full_model_id})")
    else:
        full_model_id = model_id
        print(f"Using model: {full_model_id}")
    
    # Create log file
    server_log_file = open("llama_stack_server.log", "w")
    
    # Start the server process
    cmd = f"uv run --with llama-stack llama stack run meta-reference-gpu --image-type venv --env INFERENCE_MODEL={full_model_id}"
    server_process = subprocess.Popen(
        cmd,
        shell=True,
        stdout=server_log_file,
        stderr=server_log_file,
        text=True
    )
    
    print(f"Starting Llama Stack server with PID: {server_process.pid}")
    
    # Register cleanup function
    atexit.register(cleanup)
    signal.signal(signal.SIGINT, signal_handler)
    
    return server_process

def wait_for_server_to_start(max_retries: int = 60, retry_interval: int = 2):
    """
    Wait for the server to become available.
    
    Args:
        max_retries: Maximum number of retries
        retry_interval: Seconds between retries
    
    Returns:
        bool: True if the server started successfully, False otherwise
    """
    url = "http://0.0.0.0:8321/v1/health"
    
    print("Waiting for server to start", end="")
    for _ in range(max_retries):
        try:
            response = requests.get(url, timeout=2)
            if response.status_code == 200:
                print("\n✓ Server is ready!")
                return True
        except (ConnectionError, requests.RequestException):
            print(".", end="", flush=True)
            time.sleep(retry_interval)
            
    print(f"\n✗ Server failed to start after {max_retries * retry_interval} seconds")
    print("Check the log file (llama_stack_server.log) for more information.")
    return False

def get_server_info():
    """Get information about the running server."""
    try:
        response = requests.get("http://0.0.0.0:8321/v1/models", timeout=5)
        if response.status_code == 200:
            return response.json()
        return None
    except requests.RequestException:
        return None

def kill_llama_stack_server():
    """Kill any running Llama Stack server processes."""
    print("Stopping Llama Stack server...")
    
    # Try to gracefully stop the server process first
    if server_process and server_process.poll() is None:
        server_process.terminate()
        try:
            server_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_process.kill()
    
    # Also kill any other potential llama stack server processes
    subprocess.run(
        "ps aux | grep -v grep | grep llama_stack.distribution.server.server | awk '{print $2}' | xargs -r kill -15",
        shell=True, stderr=subprocess.DEVNULL
    )
    
    print("✓ Server stopped")

def cleanup():
    """Clean up resources when the script exits."""
    if server_process and server_process.poll() is None:
        kill_llama_stack_server()
    
    if server_log_file:
        server_log_file.close()

def signal_handler(sig, frame):
    """Handle keyboard interrupts."""
    print("\nReceived interrupt signal. Shutting down...")
    cleanup()
    sys.exit(0)

def test_server(prompt="Explain what a Llama model is in one paragraph."):
    """Test the server with a simple prompt."""
    try:
        print("\nTesting server with a simple prompt...")
        headers = {"Content-Type": "application/json"}
        data = {
            "prompt": prompt,
            "max_tokens": 200,
            "temperature": 0.7
        }
        
        response = requests.post(
            "http://0.0.0.0:8321/v1/completions",
            headers=headers,
            json=data,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            print("\nServer response:")
            print("-" * 60)
            print(result["choices"][0]["text"].strip())
            print("-" * 60)
            print("✓ Server test successful!")
        else:
            print(f"✗ Server test failed with status code {response.status_code}")
            print(response.text)
    except requests.RequestException as e:
        print(f"✗ Server test failed: {e}")

def open_web_interface():
    """Open the web interface in the default browser."""
    url = "http://localhost:8321/docs"
    print(f"Opening web interface at {url}")
    webbrowser.open(url)

def print_usage_info():
    """Print information about how to use the server."""
    print("\nServer is running at http://0.0.0.0:8321")
    print("\nAPI Endpoints:")
    print("- Health check:  GET  http://0.0.0.0:8321/v1/health")
    print("- Model info:    GET  http://0.0.0.0:8321/v1/models")
    print("- Completions:   POST http://0.0.0.0:8321/v1/completions")
    print("- Chat:          POST http://0.0.0.0:8321/v1/chat/completions")
    print("- Embeddings:    POST http://0.0.0.0:8321/v1/embeddings")
    print("\nWeb interface available at: http://0.0.0.0:8321/docs")
    print("\nPython Example Usage:")
    print("""
# Example code to use the API
import requests
import json

# For text completion
response = requests.post(
    "http://0.0.0.0:8321/v1/completions",
    headers={"Content-Type": "application/json"},
    json={
        "prompt": "Write a poem about AI:",
        "max_tokens": 200,
        "temperature": 0.7
    }
)
print(response.json()["choices"][0]["text"])

# For chat completion
response = requests.post(
    "http://0.0.0.0:8321/v1/chat/completions",
    headers={"Content-Type": "application/json"},
    json={
        "messages": [
            {"role": "system", "content": "You are a helpful AI assistant."},
            {"role": "user", "content": "What is the capital of France?"}
        ],
        "max_tokens": 200
    }
)
print(response.json()["choices"][0]["message"]["content"])
""")

def interactive_menu():
    """Show an interactive menu for managing the server."""
    while True:
        print("\n" + "=" * 50)
        print("Llama Stack Server Management")
        print("=" * 50)
        print("1. Test server with a prompt")
        print("2. Open web interface")
        print("3. Display API usage information")
        print("4. View server status")
        print("5. View log file")
        print("6. Restart server")
        print("7. Quit")
        
        choice = input("\nEnter choice (1-7): ").strip()
        
        if choice == "1":
            custom_prompt = input("Enter a custom prompt (or press Enter for default): ").strip()
            if custom_prompt:
                test_server(custom_prompt)
            else:
                test_server()
        elif choice == "2":
            open_web_interface()
        elif choice == "3":
            print_usage_info()
        elif choice == "4":
            info = get_server_info()
            if info:
                print("\nServer Status: Running")
                print("Available Models:")
                for model in info["data"]:
                    print(f"- {model['id']}")
            else:
                print("\nServer Status: Not responding")
        elif choice == "5":
            try:
                with open("llama_stack_server.log", "r") as f:
                    log_content = f.read()
                    print("\n--- Log File Content (last 20 lines) ---")
                    lines = log_content.splitlines()
                    for line in lines[-20:]:
                        print(line)
            except FileNotFoundError:
                print("Log file not found.")
        elif choice == "6":
            kill_llama_stack_server()
            model_id = input("Enter model shortcut or Hugging Face model ID: ").strip()
            if not model_id:
                model_id = "llama3"  # Default model
            run_llama_stack_server(model_id)
            wait_for_server_to_start()
        elif choice == "7":
            print("Shutting down server and exiting...")
            cleanup()
            sys.exit(0)
        else:
            print("Invalid choice. Please try again.")

def main():
    """Main function to parse arguments and run the server."""
    parser = argparse.ArgumentParser(description="Run a Llama Stack server with a local model.")
    parser.add_argument(
        "--model", "-m", type=str, default="llama3",
        help="Model shortcut or Hugging Face model ID to use (default: llama3)"
    )
    parser.add_argument(
        "--list-models", "-l", action="store_true",
        help="List available model shortcuts and exit"
    )
    parser.add_argument(
        "--test", "-t", action="store_true",
        help="Test the server after starting it"
    )
    parser.add_argument(
        "--skip-deps", "-s", action="store_true",
        help="Skip dependency installation"
    )
    parser.add_argument(
        "--interactive", "-i", action="store_true",
        help="Start interactive mode after server is running"
    )
    
    args = parser.parse_args()
    
    if args.list_models:
        list_available_models()
        return
    
    # Check and install dependencies
    if not args.skip_deps:
        check_dependencies()
        install_dependencies()
    
    # Start the server
    run_llama_stack_server(args.model)
    
    # Wait for the server to start
    if not wait_for_server_to_start():
        print("Failed to start the server. Check the logs for more information.")
        cleanup()
        sys.exit(1)
    
    # Print some useful information
    print_usage_info()
    
    # Test the server if requested
    if args.test:
        test_server()
    
    # Enter interactive mode if requested
    if args.interactive:
        interactive_menu()
    else:
        # Keep the script running until interrupted
        print("\nPress Ctrl+C to stop the server and exit...")
        try:
            while server_process.poll() is None:
                time.sleep(1)
            print("\nServer process has ended. Check logs for details.")
        except KeyboardInterrupt:
            print("\nShutting down...")
            cleanup()

if __name__ == "__main__":
    main()