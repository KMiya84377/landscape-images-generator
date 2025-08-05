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

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let isClosed = false;

  const safeClose = () => {
    if (!isClosed) {
      isClosed = true;
      try {
        controller.close();
      } catch (error) {
        console.warn('Controller already closed:', error);
      }
    }
  };

  const safeEnqueue = (data: Uint8Array) => {
    if (!isClosed) {
      try {
        controller.enqueue(data);
      } catch (error) {
        console.warn('Failed to enqueue data:', error);
        isClosed = true;
      }
    }
  };

  try {
    const encodedEndpoint = encodeURIComponent(process.env.AGENT_CORE_ENDPOINT || '');
    const fullUrl = `${BEDROCK_AGENT_CORE_ENDPOINT_URL}/runtimes/${encodedEndpoint}/invocations`;

    const fetchStartTime = Date.now();
    console.log(`🌐 [${new Date().toISOString()}] Starting AgentCore request to: ${fullUrl}`);

    const agentResponse = await fetch(fullUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: prompt.trim(),
      }),
    });

    const fetchEndTime = Date.now();
    console.log(`📡 [${new Date().toISOString()}] AgentCore response received (${fetchEndTime - fetchStartTime}ms)`);

    if (!agentResponse.ok) {
      throw new Error(`AgentCore returned ${agentResponse.status}: ${agentResponse.statusText}`);
    }

    if (!agentResponse.body) {
      throw new Error('No response body from AgentCore');
    }

    reader = agentResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;
    let firstChunkTime: number | null = null;

    console.log(`📖 [${new Date().toISOString()}] Starting stream reading`);

    while (!isClosed) {
      const chunkStartTime = Date.now();
      const { done, value } = await reader.read();

      if (done) {
        console.log(`🏁 [${new Date().toISOString()}] Stream completed after ${chunkCount} chunks`);
        break;
      }

      chunkCount++;
      if (firstChunkTime === null) {
        firstChunkTime = Date.now();
        console.log(`🥇 [${new Date().toISOString()}] First chunk received (${firstChunkTime - fetchEndTime}ms after response)`);
      }

      const chunk = decoder.decode(value, { stream: true });
      const chunkSize = chunk.length;
      console.log(`📦 [${new Date().toISOString()}] Chunk ${chunkCount}: ${chunkSize} bytes (${Date.now() - chunkStartTime}ms)`);

      buffer += chunk;

      // 即座に処理するため、改行ごとに分割して順次処理
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line || isClosed) continue;

        // SSE形式の処理
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            safeClose();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            console.log(`📤 [${new Date().toISOString()}] Sending SSE data:`, JSON.stringify(parsed).substring(0, 100) + '...');
            
            // CloudFrontバッファリング回避のため大きなチャンクで送信
            const sseData = `data: ${JSON.stringify(parsed)}\n\n`;
            const forceStreamingSize = 32768; // 32KB - より確実にストリーミングするサイズ
            
            // 大きなパディングで強制的にストリーミングモードにする
            const padding = ' '.repeat(Math.max(0, forceStreamingSize - sseData.length));
            const streamingSSE = `data: ${JSON.stringify(parsed)}\n: force-streaming${padding}\n\n`;
            
            safeEnqueue(encoder.encode(streamingSSE));
          } catch {
            // JSONパースエラーは無視
          }
        } else {
          // JSON形式の直接レスポンスの場合
          try {
            const parsed = JSON.parse(line);
            safeEnqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
          } catch {
            // JSONパースエラーは無視
          }
        }
      }
    }

    // バッファに残ったデータを処理
    if (buffer.trim() && !isClosed) {
      try {
        const parsed = JSON.parse(buffer);
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
      } catch {
        // JSONパースエラーは無視
      }
    }

    safeClose();
  } catch (error) {
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        // リーダーのリリースに失敗しても続行
      }
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  const lambdaTimeout = parseInt(process.env.AWS_LAMBDA_FUNCTION_TIMEOUT || '900') * 1000; // 秒をミリ秒に変換

  console.log(`⏰ [${new Date().toISOString()}] Request started`);
  console.log(`⏱️ Lambda timeout: ${lambdaTimeout}ms (${lambdaTimeout / 1000}s)`);

  try {
    // Lambda環境情報
    console.log('🚀 API Route started successfully');
    console.log('Lambda Function:', process.env.AWS_LAMBDA_FUNCTION_NAME);
    console.log('Execution Env:', process.env.AWS_EXECUTION_ENV);
    console.log('Lambda Timeout:', process.env.AWS_LAMBDA_FUNCTION_TIMEOUT || 'Unknown');
    console.log('Lambda Memory:', process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || 'Unknown');
    console.log('Lambda Region:', process.env.AWS_REGION || 'Unknown');

    // CloudFront情報の推測
    const isCloudFront = request.headers.get('cloudfront-viewer-country') !== null;
    const cfRequestId = request.headers.get('x-amz-cf-id');
    console.log('CloudFront detected:', isCloudFront);
    console.log('CloudFront Request ID:', cfRequestId || 'None');

    if (isCloudFront) {
      console.log('⚠️ CloudFront timeout: ~30 seconds (estimated)');
    }

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
        console.log('🚀 SSE Stream started');
        const encoder = new TextEncoder();

        // CloudFrontバッファリング回避のための初期データ
        const initialData = {
          status: "connecting",
          timestamp: new Date().toISOString(),
          sessionId: sessionId
        };
        
        const initialSSE = `data: ${JSON.stringify(initialData)}\n\n`;
        const forceStreamingSize = 32768; // 32KB
        
        // 大きな初期データでCloudFrontを強制的にストリーミングモードにする
        const padding = ' '.repeat(Math.max(0, forceStreamingSize - initialSSE.length));
        const streamingInitial = `data: ${JSON.stringify(initialData)}\n: streaming-mode${padding}\n\n`;
        
        controller.enqueue(encoder.encode(streamingInitial));
        console.log(`📡 Initial ${streamingInitial.length} bytes sent to force streaming mode`);

        // CloudFrontのKeep-Alive(5秒)より短い間隔でハートビート
        const heartbeatInterval = setInterval(() => {
          if (!controller.desiredSize || controller.desiredSize <= 0) {
            clearInterval(heartbeatInterval);
            return;
          }

          // 8KB以上のハートビートでバッファリング回避
          // 16KBのハートビートでCloudFrontストリーミングを維持
          const heartbeatData = {
            type: "heartbeat",
            timestamp: new Date().toISOString()
          };
          
          const heartbeatSSE = `data: ${JSON.stringify(heartbeatData)}\n\n`;
          const forceStreamingSize = 32768; // 32KB
          const padding = ' '.repeat(Math.max(0, forceStreamingSize - heartbeatSSE.length));
          const streamingHeartbeat = `data: ${JSON.stringify(heartbeatData)}\n: heartbeat-streaming${padding}\n\n`;
          
          controller.enqueue(encoder.encode(streamingHeartbeat));
        }, 1000); // 1秒間隔でより頻繁にストリーミングを維持

        try {
          await streamFromAgentCore(accessToken, prompt, sessionId, controller);
          clearInterval(heartbeatInterval);
          console.log('✅ SSE Stream completed successfully');
        } catch (error) {
          clearInterval(heartbeatInterval);
          console.log('❌ SSE Stream failed:', error);
          logError('AgentCore通信', error);
          const errorMessage = getErrorMessage(error);

          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `AgentCore通信エラー: ${errorMessage}` })}\n\n`));
            controller.close();
          } catch (controllerError) {
            console.warn('Controller operation failed:', controllerError);
          }
        }
      },
    });

    const responseTime = Date.now() - requestStartTime;
    const cloudFrontTimeout = 30000; // 30秒固定
    const lambdaTimeoutWarning = responseTime > (lambdaTimeout * 0.8) ? ' ⚠️ LAMBDA TIMEOUT RISK' : '';
    const cloudFrontTimeoutWarning = responseTime > (cloudFrontTimeout * 0.8) ? ' 🌩️ CLOUDFRONT TIMEOUT RISK' : '';

    console.log(`✅ [${new Date().toISOString()}] Response created (total: ${responseTime}ms)`);
    console.log(`📊 Timeouts - Lambda: ${lambdaTimeout}ms, CloudFront: ${cloudFrontTimeout}ms (estimated)`);
    console.log(`⚡ Status: ${responseTime}ms${lambdaTimeoutWarning}${cloudFrontTimeoutWarning}`);

    return new Response(stream, {
      headers: {
        // SSE必須ヘッダー
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Connection': 'keep-alive',

        // CloudFront最適化ヘッダー
        'Transfer-Encoding': 'chunked',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',

        // HTTP/2最適化
        'Vary': 'Accept-Encoding',

        // CORS
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Token',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
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