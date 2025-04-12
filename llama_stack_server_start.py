import os 
import subprocess
import time

!uv pip install requests

if "UV_SYSTEM_PYTHON" in os.environ:
  del os.environ["UV_SYSTEM_PYTHON"]

# this command installs all the dependencies needed for the llama stack server 
!uv run --with llama-stack llama stack build --template meta-reference-gpu --image-type venv 

def run_llama_stack_server_background():
    log_file = open("llama_stack_server.log", "w")
    process = subprocess.Popen(
        f"uv run --with llama-stack llama stack run meta-reference-gpu --image-type venv --env INFERENCE_MODEL={model_id}",
        shell=True,
        stdout=log_file,
        stderr=log_file,
        text=True
    )
    
    print(f"Starting Llama Stack server with PID: {process.pid}")
    return process

def wait_for_server_to_start():
    import requests
    from requests.exceptions import ConnectionError
    import time
    
    url = "http://0.0.0.0:8321/v1/health"
    max_retries = 30
    retry_interval = 1
    
    print("Waiting for server to start", end="")
    for _ in range(max_retries):
        try:
            response = requests.get(url)
            if response.status_code == 200:
                print("\nServer is ready!")
                return True
        except ConnectionError:
            print(".", end="", flush=True)
            time.sleep(retry_interval)
            
    print("\nServer failed to start after", max_retries * retry_interval, "seconds")
    return False


# use this helper if needed to kill the server 
def kill_llama_stack_server():
    # Kill any existing llama stack server processes
    os.system("ps aux | grep -v grep | grep llama_stack.distribution.server.server | awk '{print $2}' | xargs kill -9")
