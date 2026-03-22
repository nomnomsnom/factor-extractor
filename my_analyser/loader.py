from langchain_community.document_loaders import PyPDFDirectoryLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

def load_and_chunk(folder_path: str) -> list:
    loader = PyPDFDirectoryLoader(folder_path)
    docs = loader.load()
    
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200
    )
    chunks = splitter.split_documents(docs)
    
    print(f"Loaded {len(docs)} pages")
    print(f"Split into {len(chunks)} chunks")
    
    return chunks