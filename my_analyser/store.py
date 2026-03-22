from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

def create_store(chunks):
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    vector_store = Chroma.from_documents(
    documents=chunks,
    embedding=embeddings,
    persist_directory="chroma_db"
)
    return vector_store

