from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
import json
import re

load_dotenv()

def validate_factor(factor: dict) -> dict:
    context = json.dumps(factor)
    chat_model = ChatAnthropic(model="claude-sonnet-4-20250514")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a quantitative finance research assistant.
Evaluate whether the provided factor is a valid financial factor.
Return ONLY valid JSON, no other text:
{{
    "is_valid": true or false,
    "confidence": 1 to 5,
    "reason": "your explanation"
}}
Criteria:
- is_valid: is this a real measurable financial factor?
- confidence: how accurate and realistic is the description and data required? 5 = very accurate, 1 = very poor
- reason: brief explanation for both scores"""),
        ("human", "{context}")
    ])
    
    chain = prompt | chat_model | StrOutputParser()
    raw = chain.invoke({"context": context})
    
    # clean markdown fences
    raw = raw.strip()
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if match:
        raw = match.group()
    
    try:
        validation = json.loads(raw)
    except json.JSONDecodeError:
        return {"is_valid": False, "confidence": 0, "reason": "failed to parse validation"}
    
    # attach validation fields to original factor
    factor["is_valid"] = validation.get("is_valid", False)
    factor["confidence"] = validation.get("confidence", 0)
    factor["reason"] = validation.get("reason", "")
    
    return factor