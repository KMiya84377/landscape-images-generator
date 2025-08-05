from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel

MODEL_ID = "anthropic.claude-3-5-sonnet-20240620-v1:0"

def create_agent():
    """エージェントを作成"""
    return Agent(
        model=BedrockModel(model_id=MODEL_ID, region="us-east-1"),
    )

app = BedrockAgentCoreApp()
agent = create_agent()

@app.entrypoint
async def invoke(payload):
    """エージェントに質問を投げてレスポンスを取得する"""
    user_prompt = payload.get("prompt", "No prompt found in input, please guide customer to create a json payload with prompt key")
    agent_stream = agent.stream_async(user_prompt)
    async for event in agent_stream:
        if "event" in event:
            yield event

if __name__ == "__main__":
    app.run()