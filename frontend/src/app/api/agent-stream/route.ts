import { NextRequest } from 'next/server';
import { verifyJWT } from '@/lib/auth-utils';
import { getErrorMessage, logError } from '@/lib/error-utils';

const BEDROCK_AGENT_CORE_ENDPOINT_URL = "https://bedrock-agentcore.us-east-1.amazonaws.com"

async function authenticate(request: NextRequest): Promise<{ idToken: string; accessToken: string }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing ID token');
  }

  const idToken = authHeader.substring(7);
  const isValid = await verifyJWT(idToken);
  if (!isValid) {
    throw new Error('Invalid ID token');
  }

  const accessToken = request.headers.get('x-access-token');
  if (!accessToken) {
    throw new Error('Missing access token');
  }

  return { idToken, accessToken };
}

async function streamFromAgentCore(
  accessToken: string,
  prompt: string,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();
  const fullUrl = `${BEDROCK_AGENT_CORE_ENDPOINT_URL}/runtimes/${encodeURIComponent(process.env.AGENT_CORE_ENDPOINT || '')}/invocations`;

  console.log(`🌐 Connecting to AgentCore`);
  const response = await fetch(fullUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ prompt: prompt.trim() }),
  });

  if (!response.ok) {
    console.log(`❌ AgentCore error: ${response.status} ${response.statusText}`);
    throw new Error(`AgentCore returned ${response.status}: ${response.statusText}`);
  }

  if (!response.body) {
    console.log(`❌ No response body from AgentCore`);
    throw new Error('No response body from AgentCore');
  }

  console.log(`📡 AgentCore connected, starting stream`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;
  let firstChunkTime: number | null = null;
  const streamStartTime = Date.now();

  try {
    while (true) {
      const chunkStartTime = Date.now();
      const { done, value } = await reader.read();
      if (done) {
        console.log(`🏁 Stream completed: ${chunkCount} chunks in ${Date.now() - streamStartTime}ms`);
        break;
      }

      chunkCount++;
      if (firstChunkTime === null) {
        firstChunkTime = Date.now();
        console.log(`🥇 First chunk received: ${firstChunkTime - streamStartTime}ms after stream start`);
      }

      const chunkSize = value.length;
      const chunkTime = Date.now() - chunkStartTime;
      console.log(`📦 Chunk ${chunkCount}: ${chunkSize} bytes (${chunkTime}ms)`);

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) continue;

        // SSE形式の処理
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            console.log(`📤 Sending SSE data: ${JSON.stringify(parsed).substring(0, 50)}...`);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
          } catch {
            // JSONパースエラーは無視
          }
        } else {
          // JSON形式の直接レスポンス
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
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log(`🚀 SSE request started`);

  // ストリーミング環境の確認
  const isCloudFront = request.headers.get('cloudfront-viewer-country') !== null;
  const acceptHeader = request.headers.get('accept');
  console.log(`🔍 Streaming environment check:`);
  console.log(`   - CloudFront: ${isCloudFront ? 'Yes' : 'No'}`);
  console.log(`   - Accept header: ${acceptHeader}`);
  console.log(`   - User-Agent: ${request.headers.get('user-agent')?.substring(0, 50)}...`);

  try {
    // 認証
    const { accessToken } = await authenticate(request);
    console.log(`✅ Authentication successful`);

    // リクエストボディ
    const { prompt } = await request.json();
    if (!prompt?.trim()) {
      console.log(`❌ Empty prompt provided`);
      return new Response('Bad Request: Empty prompt', { status: 400 });
    }

    console.log(`📝 Prompt received (${prompt.length} chars)`);

    // SSEストリーム
    const stream = new ReadableStream({
      async start(controller) {
        console.log(`🌊 Starting SSE stream`);
        try {
          await streamFromAgentCore(accessToken, prompt, controller);
          console.log(`✅ SSE stream completed successfully`);
        } catch (error) {
          console.log(`❌ SSE stream failed:`, error);
          const encoder = new TextEncoder();
          const errorMessage = getErrorMessage(error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    const responseTime = Date.now() - startTime;
    console.log(`📤 SSE response created (${responseTime}ms)`);

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
    const responseTime = Date.now() - startTime;

    // 認証エラー
    if (error instanceof Error &&
      (error.message.includes('Missing') || error.message.includes('Invalid'))) {
      console.log(`🔒 Authentication failed: ${error.message} (${responseTime}ms)`);
      return new Response(`Unauthorized: ${error.message}`, { status: 401 });
    }

    // その他のエラー
    console.log(`💥 SSE endpoint error: ${getErrorMessage(error)} (${responseTime}ms)`);
    logError('SSEエンドポイント', error);
    return new Response(`Internal Server Error: ${getErrorMessage(error)}`, { status: 500 });
  }
}