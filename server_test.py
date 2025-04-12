import requests
url = "http://localhost:11434/api/generate"
try:
    response = requests.post(url, json={"prompt": "Say 'TEST_OK'", "stream": False}, timeout=10)
    if response.ok and "TEST_OK" in response.json()["response"]:
        print("✅ Server operational with working inference")
    else:
        print(f"❌ Server error: {response.status_code} {response.text}")
except Exception as e:
    print(f"🚨 Connection failed: {str(e)}")
