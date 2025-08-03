import { NextRequest } from 'next/server';
import { verifyJWT } from '@/lib/auth-utils';
import { getErrorMessage, logError } from '@/lib/error-utils';

const BEDROCK_AGENT_CORE_ENDPOINT_URL = "https://bedrock-agentcore.us-east-1.amazonaws.com"

/**
 * リクエストからIDトークンを抽出・検証する
 */
async function validateIdToken(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing ID token');
  }

  const idToken = authHeader.substring(7);
  const isValid = await verifyJWT(idToken);
  if (!isValid) {
    throw new Error('Invalid ID token');
  }

  return idToken;
}

/**
 * リクエストからアクセストークンを抽出する
 */
function extractAccessToken(request: NextRequest): string {
  const accessToken = request.headers.get('x-access-token');
  if (!accessToken) {
    throw new Error('Missing access token');
  }
  return accessToken;
}

/**
 * AgentCore Runtimeとの通信を処理する
 */
async function streamFromAgentCore(
  accessToken: string,
  prompt: string,
  _sessionId: string,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  try {
    const encodedEndpoint = encodeURIComponent(process.env.AGENT_CORE_ENDPOINT || '');
    const fullUrl = `${BEDROCK_AGENT_CORE_ENDPOINT_URL}/runtimes/${encodedEndpoint}/invocations`;

    const agentResponse = await fetch(fullUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: prompt.trim(),
      }),
    });

    if (!agentResponse.ok) {
      throw new Error(`AgentCore returned ${agentResponse.status}: ${agentResponse.statusText}`);
    }

    if (!agentResponse.body) {
      throw new Error('No response body from AgentCore');
    }

    const reader = agentResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    console.log('ストリーミング開始');

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('ストリーミング完了');
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // 改行で分割してイベントを処理
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 最後の不完全な行は保持

      for (const line of lines) {
        if (line.trim() === '') continue;

        // SSE形式の処理
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            controller.close();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
          } catch {
            // JSONパースエラーは無視
          }
        } else {
          // JSON形式の直接レスポンスの場合
          try {
            const parsed = JSON.parse(line);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
          } catch {
            // JSONパースエラーは無視
          }
        }
      }
    }

    // バッファに残ったデータを処理
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
      } catch {
        // JSONパースエラーは無視
      }
    }

    controller.close();
  } catch (error) {
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    // IDトークンを検証
    await validateIdToken(request);

    // アクセストークンを取得
    const accessToken = extractAccessToken(request);

    const { prompt, sessionId } = await request.json();

    // プロンプトの検証
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return new Response('Bad Request: Empty or invalid prompt', { status: 400 });
    }

    // AgentCore Runtimeとの通信用ストリーム
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await streamFromAgentCore(accessToken, prompt, sessionId, controller);
        } catch (error) {
          logError('AgentCore通信', error);
          const errorMessage = getErrorMessage(error);
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `AgentCore通信エラー: ${errorMessage}` })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Token',
      },
    });
  } catch (error) {
    // 認証エラーの場合
    if (error instanceof Error &&
      (error.message.includes('Missing') || error.message.includes('Invalid'))) {
      return new Response(`Unauthorized: ${error.message}`, { status: 401 });
    }

    // その他のエラー
    logError('SSEエンドポイント', error);
    const errorMessage = getErrorMessage(error);
    return new Response(`Internal Server Error: ${errorMessage}`, { status: 500 });
  }
}