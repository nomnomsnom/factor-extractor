# Simple RAG agent

Answers queries with pdf context using claude sonnet 4

## How it works
1 Loads PDF papers and splits into chunks with overlap to preserve context at boundaries
2 Stores chunks in ChromaDB vector store
3 Retrieves relevant context using similarity search
4 Gives context to claude sonnet 4 to answer the query

## Setup
Steps to install and run:
1. Clone the repo
2. Create a venv and activate it
3. pip install -r requirements.txt
4. Add your ANTHROPIC_API_KEY to a .env file
5. Run python main.py

## Output
A natural language answer to your query, grounded in the content of your PDF documents rather than the model's training data.

## Tech stack
- Python 3.11
- LangChain
- Claude Sonnet (Anthropic API)
- ChromaDB
- HuggingFace Embeddings (all-MiniLM-L6-v2)
