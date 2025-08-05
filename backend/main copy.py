from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from strands_tools import use_aws
from mcp import stdio_client, StdioServerParameters

MODEL_ID = "anthropic.claude-3-5-sonnet-20240620-v1:0"

def create_location_mcp_client():
    """Amazon Location Service MCPクライアントを作成"""
    return MCPClient(lambda: stdio_client(
        StdioServerParameters(
            command="uvx",
            args=[
                "--from",
                "awslabs.aws-location-mcp-server@latest",
                "awslabs.aws-location-mcp-server.exe"
            ],
            env={
                "FASTMCP_LOG_LEVEL": "ERROR",
                "AWS_PROFILE": "k_miyazaki",
                "AWS_REGION": "us-east-1",
            }
        )
    ))

def create_nova_canvas_mcp_client():
    """Nova Canvas MCPクライアントを作成"""
    return MCPClient(lambda: stdio_client(
        StdioServerParameters(
            command="uvx",
            args=[
                "--from",
                "awslabs.nova-canvas-mcp-server@latest",
                "awslabs.nova-canvas-mcp-server.exe"
            ],
            env={
                "FASTMCP_LOG_LEVEL": "ERROR",
                "AWS_PROFILE": "k_miyazaki",
                "AWS_REGION": "us-east-1",
            }
        )
    ))

def create_agent(location_mcp_client, nova_canvas_mcp_client):
    """エージェントを作成"""
    return Agent(
        model=BedrockModel(model_id=MODEL_ID, region="us-east-1"),
        tools=location_mcp_client.list_tools_sync() + nova_canvas_mcp_client.list_tools_sync() + [use_aws],
    )

app = BedrockAgentCoreApp()

# MCPクライアントを作成
location_mcp_client = create_location_mcp_client()
nova_canvas_mcp_client = create_nova_canvas_mcp_client()

# MCPクライアントを使用してエージェントを作成
with location_mcp_client, nova_canvas_mcp_client:
    agent = create_agent(location_mcp_client, nova_canvas_mcp_client)

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