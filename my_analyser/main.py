import os
from loader import load_and_chunk
from store import create_store
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from retriever import retrieve
from analyser import analyse


embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

if os.path.exists("chroma_db"):
    # store already exists, just load it
    vector_store = Chroma(
        persist_directory="chroma_db",
        embedding_function=embeddings
    )
    print("Loaded existing vector store")
else:
    # first time, create it
    chunks = load_and_chunk("papers/")
    vector_store = create_store(chunks)
    print("Vector store created successfully")

answer = analyse("what is factor momentum?")
print(answer)