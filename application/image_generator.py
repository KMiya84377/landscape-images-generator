import asyncio
import streamlit as st
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from mcp import stdio_client, StdioServerParameters
import datetime
import os

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
                "AWS_PROFILE": "xxxx",
                "AWS_REGION": "ap-northeast-1",
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
                "AWS_PROFILE": "xxxx",
                "AWS_REGION": "ap-northeast-1",
            }
        )
    ))

def create_agent(location_mcp_client, nova_canvas_mcp_client):
    """エージェントを作成"""
    return Agent(
        model=BedrockModel(model_id=MODEL_ID),
        tools=location_mcp_client.list_tools_sync() + nova_canvas_mcp_client.list_tools_sync()
    )

def extract_tool_info(chunk):
    """チャンクからツール情報を抽出"""
    event = chunk.get('event', {})
    if 'contentBlockStart' in event:
        tool_use = event['contentBlockStart'].get('start', {}).get('toolUse', {})
        return tool_use.get('toolUseId'), tool_use.get('name')
    return None, None

def extract_text(chunk):
    """チャンクからテキストを抽出"""
    if text := chunk.get('data'):
        return text
    elif delta := chunk.get('delta', {}).get('text'):
        return delta
    return ""

async def stream_response(agent, question, container):
    """レスポンスをストリーミング表示"""
    text_holder = container.empty()
    buffer = ""
    shown_tools = set()
    generated_images = []
    
    try:
        async for chunk in agent.stream_async(question):
            if isinstance(chunk, dict):
                # ツール実行を検出して表示
                tool_id, tool_name = extract_tool_info(chunk)
                if tool_id and tool_name and tool_id not in shown_tools:
                    shown_tools.add(tool_id)
                    if buffer:
                        text_holder.markdown(buffer)
                        buffer = ""
                    container.info(f"🔧 **{tool_name}** ツールを実行中...")
                    text_holder = container.empty()
                
                # 画像生成結果を検出
                if 'toolResult' in chunk.get('event', {}):
                    tool_result = chunk['event']['toolResult']
                    if 'content' in tool_result:
                        for content in tool_result['content']:
                            if content.get('type') == 'image':
                                # 画像データを取得
                                image_data = content.get('data')
                                if image_data:
                                    generated_images.append(image_data)
                                    # 画像生成完了を通知のみ
                                    container.success("🎨 画像生成完了！")
                
                # テキストを抽出して表示
                if text := extract_text(chunk):
                    buffer += text
                    text_holder.markdown(buffer + "▌")
    
    except asyncio.CancelledError:
        container.warning("⚠️ 処理がキャンセルされました")
        raise
    except Exception as e:
        container.error(f"❌ ストリーミング中にエラーが発生: {str(e)}")
        raise
    finally:
        # 最終表示
        if buffer:
            text_holder.markdown(buffer)
    
    return generated_images

def create_prompt(lat, lng, style, time, weather, custom, save_folder, filename_format, custom_filename=None):
    """プロンプトを生成"""
    
    # ファイル名の生成
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    
    if filename_format == "coordinates_timestamp":
        filename = f"lat_{lat:.6f}_lng_{lng:.6f}_{timestamp}"
    elif filename_format == "timestamp_only":
        filename = f"generated_{timestamp}"
    elif filename_format == "coordinates_only":
        filename = f"lat_{lat:.6f}_lng_{lng:.6f}"
    elif filename_format == "custom" and custom_filename:
        filename = f"{custom_filename}_{timestamp}"
    else:
        filename = f"generated_{timestamp}"
    
    return f"""
    以下の条件に従って、画像を生成してください

    ### 条件1：緯度、経度からsearch_nearbyツールを使って情報を取得する
    - 緯度 {lat:.6f}, 経度 {lng:.6f}
    
    ### 以下の条件と条件1の取得結果から、generate_imageツールを使用して画像生成する
    - スタイル: {style}
    - 時間帯: {time}
    - 天気: {weather}
    - 追加要求: {custom}
    
    生成した画像は以下の条件で保存してください
    
    ### 保存設定
    - 保存先フォルダ: {save_folder}
    - ファイル名: {filename}
    - workspace_dir パラメータに {save_folder} を設定してください
    - filename パラメータに {filename} を設定してください
    
    ### generate_imageツールでエラーの場合
    - 詳細なエラーコードやメッセージを表示してください。
    """

def validate_and_create_folder(save_folder, create_folder):
    """保存先フォルダの検証と作成を行う"""
    if not save_folder:
        return True  # フォルダが指定されていない場合はスキップ
    
    if os.path.exists(save_folder):
        return True  # フォルダが既に存在する場合は成功
    
    if create_folder:
        try:
            os.makedirs(save_folder, exist_ok=True)
            st.sidebar.success(f"✅ フォルダを作成しました: {save_folder}")
            return True
        except Exception as e:
            st.sidebar.error(f"❌ フォルダの作成に失敗しました: {str(e)}")
            return False
    else:
        st.sidebar.error(f"❌ 保存先フォルダが存在しません: {save_folder}")
        return False

def process_image_generation(current_lat, current_lng, settings):
    """画像の生成処理を実行"""
    
    # 保存先フォルダの検証と作成
    if not validate_and_create_folder(settings["save_folder"], settings["create_folder"]):
        return False
    
    # サイドバーにスピナー表示
    status_placeholder = st.sidebar.empty()
    status_placeholder.info("🔄 画像を生成中...")
    
    # MCPクライアントを作成
    location_mcp_client = create_location_mcp_client()
    nova_canvas_mcp_client = create_nova_canvas_mcp_client()
    
    # MCPクライアントを使用してエージェントを作成
    with location_mcp_client, nova_canvas_mcp_client:
        agent = create_agent(location_mcp_client, nova_canvas_mcp_client)

        # サイドバーにコンテナを作成
        container = st.sidebar.container()
        
        # プロンプトを作成
        enhanced_question = create_prompt(
            current_lat, current_lng, settings["image_style"], 
            settings["time_of_day"], settings["weather"], settings["custom_prompt"],
            settings["save_folder"], settings["filename_format"], settings["custom_filename"]
        )
        
        # 非同期実行
        loop = None
        try:
            # 既存のイベントループがある場合は新しいループを作成
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # 既存のループが実行中の場合は新しいループを作成
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
            except RuntimeError:
                # イベントループが存在しない場合は新しいループを作成
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            # タスクを実行
            generated_images = loop.run_until_complete(
                stream_response(agent, enhanced_question, container)
            )
            
            # 生成された画像をセッションステートに保存
            if generated_images:
                st.session_state.generated_images.extend(generated_images)
                status_placeholder.success(f"✅ {len(generated_images)}枚の画像が生成されました！")
                st.sidebar.info(f"📁 保存先: {settings['save_folder']}")
                return True
            else:
                status_placeholder.warning("⚠️ 画像の生成に失敗しました。")
                return False
                
        except Exception as e:
            status_placeholder.error(f"❌ エラーが発生しました: {str(e)}")
            return False
        finally:
            # イベントループを適切にクリーンアップ
            if loop and not loop.is_closed():
                # 保留中のタスクをキャンセル
                pending_tasks = asyncio.all_tasks(loop)
                for task in pending_tasks:
                    task.cancel()
                
                # キャンセルされたタスクの完了を待つ
                if pending_tasks:
                    try:
                        loop.run_until_complete(asyncio.gather(*pending_tasks, return_exceptions=True))
                    except Exception:
                        pass  # キャンセルされたタスクの例外は無視
                
                # ループを閉じる
                loop.close()
