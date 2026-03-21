from langchain_anthropic import ChatAnthropic

chat_model = ChatAnthropic(
    model="claude-sonnet-4-20250514",
    temperature=0
)

chat_model.invoke("Tell me a joke about bears!")