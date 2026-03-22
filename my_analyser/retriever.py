from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

def retrieve(query: str) -> list:
    # load store, search, return results
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    vector_store = Chroma(
        persist_directory="chroma_db",
        embedding_function=embeddings
)
    results = vector_store.similarity_search(query, k=3)
    return results