from llama_stack.distribution.library_client import LlamaStackAsLibraryClient

client = LlamaStackAsLibraryClient(
    "groq",)

client.initialize()

response = client.models.list()

print(response)
