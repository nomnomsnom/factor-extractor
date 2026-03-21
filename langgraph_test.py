from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage
from typing import TypedDict
load_dotenv()

#STATE
class Agentstate(TypedDict):
    messages : list

#NODE
def call_claude(state: Agentstate) -> Agentstate:
    model= ChatAnthropic(model="claude-sonnet-4-20250514")
    response=model.invoke(state["messages"])
    return {"messages": state["messages"]+[response]}

#GRAPH
graph_builder=StateGraph(Agentstate)
graph_builder.add_node("call_claude",call_claude)
graph_builder.set_entry_point("call_claude")
graph_builder.add_edge("call_claude",END)
graph = graph_builder.compile()

#RUN
result = graph.invoke({
    "messages": [HumanMessage("What is momentum factor?")]
})

print(result["messages"][-1].content)
