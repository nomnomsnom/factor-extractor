from dotenv import load_dotenv
from retriever import retrieve
from langchain_anthropic import ChatAnthropic
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

load_dotenv()

def analyse(query: str) -> str:
    results = retrieve(query)
    context = "\n\n".join([doc.page_content for doc in results])
    
    chat_model = ChatAnthropic(model="claude-sonnet-4-20250514")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a quantitative finance research assistant.
Answer the question using only the provided context.
If the context doesn't contain enough information, say so."""),
        ("human", "Context:\n{context}\n\nQuestion: {query}")
    ])
    
    chain = prompt | chat_model | StrOutputParser()
    
    return chain.invoke({
        "context": context,
        "query": query
    })