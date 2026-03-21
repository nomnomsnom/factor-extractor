from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

# your factor extraction logic using LangChain
sample_text = """
name: snom's practice paper
This paper examines the momentum factor, defined as the 
12-month return excluding the most recent month. We also 
study the value factor, measured by book-to-market ratio.
This study uses OLS regression as the primary methodology.
The sample consists of 5,000 US equities from 1990 to 2020,
sourced from CRSP database.
"""
chat_model = ChatAnthropic(model_name="claude-sonnet-4-20250514")
prompt = ChatPromptTemplate.from_messages([
    ("system", """You are a quantitative finance research assistant.
Extract factors, methodology and sample size from the given text.
Return ONLY valid JSON in this format, no other text:
{{
  "factors": [
    {{
      "name": "",
      "description": "",
      "data_required": []
    }}
  ],
  "methodology": "",
  "sample_size": ""
}}"""),
    ("human", "{text}")
])

chain = prompt | chat_model | StrOutputParser()

result = chain.invoke({"text": sample_text})
print(result)





