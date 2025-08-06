import { useState, useCallback, useRef } from 'react';
import { useAuth } from './useAuth';
import { logError, getApiErrorDetails } from '@/lib/error-utils';

interface SSEChatOptions {
  maxRetries?: number;
  retryDelay?: number;
}

// セッションID生成
const generateSessionId = (): string =>
  `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// データ抽出
const extractDataFromLine = (line: string): string | null => {
  if (line.startsWith('data: ')) {
    const data = line.slice(6).trim();
    return data === '[DONE]' ? null : data;
  }
  // SSEコメント行（: で始まる行）は無視
  if (line.startsWith(': ')) {
    return null;
  }
  return line.trim() || null;
};

// 型定義
interface ContentBlockDelta {
  contentBlockDelta?: {
    delta?: {
      text?: string;
    };
  };
}

interface MessageData {
  content?: string;
}

// メッセージ内容抽出
const extractMessageContent = (parsed: Record<string, unknown>): string | null => {
  // エラーチェック
  if (parsed.error && typeof parsed.error === 'string') {
    throw new Error(parsed.error);
  }

  // 新しいイベント形式（contentBlockDelta）
  const event = parsed.event as ContentBlockDelta;
  if (event?.contentBlockDelta?.delta?.text && typeof event.contentBlockDelta.delta.text === 'string') {
    return event.contentBlockDelta.delta.text;
  }

  // イベント形式（Strands/AgentCore）
  if (parsed.event && typeof parsed.event === 'string') {
    const textEvents = ['text', 'chunk', 'delta'];
    if (textEvents.includes(parsed.event) && parsed.data && typeof parsed.data === 'string') {
      return parsed.data;
    }
    if (parsed.event === 'message' && parsed.data && typeof parsed.data === 'object' && parsed.data !== null) {
      const data = parsed.data as MessageData;
      if (data.content && typeof data.content === 'string') {
        return data.content;
      }
    }
    return null;
  }

  // 従来形式
  if (parsed.content && typeof parsed.content === 'string') return parsed.content;
  if (parsed.data && typeof parsed.data === 'string') return parsed.data;

  return null;
};

// ストリーミング処理
const processStreamingResponse = async (
  response: Response,
  onMessageUpdate: (message: string) => void,
  onComplete: (finalMessage: string) => void
): Promise<void> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let currentMessage = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        console.log(`📥 [${new Date().toISOString()}] Received line:`, line);

        const dataToProcess = extractDataFromLine(line);
        if (!dataToProcess) {
          if (line.includes('[DONE]')) {
            console.log('🏁 Stream completed with [DONE]');
            break;
          }
          // SSEコメント行は extractDataFromLine で既に除外済み
          continue;
        }

        console.log('📦 Data to process:', dataToProcess);

        try {
          const parsed = JSON.parse(dataToProcess);
          console.log('🔍 Parsed data:', parsed);

          // CloudFront対策用のメッセージを無視
          if (parsed.status === 'connecting' || parsed.type === 'heartbeat') {
            console.log(`🔗 ${parsed.type || 'connection'} message received, continuing...`);
            continue;
          }

          const content = extractMessageContent(parsed);
          console.log('📝 Extracted content:', content);

          if (content) {
            currentMessage += content;
            onMessageUpdate(currentMessage);
            console.log('✅ Message updated:', currentMessage);
          }
        } catch (parseError) {
          console.warn('❌ JSON parse error:', parseError, 'Raw data:', dataToProcess);
        }
      }
    }

    onComplete(currentMessage);
  } finally {
    reader.releaseLock();
  }
};

export function useSSEChat(options: SSEChatOptions = {}) {
  const { maxRetries = 3, retryDelay = 1000 } = options;
  const [messages, setMessages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { getAuthTokens } = useAuth();
  const sessionIdRef = useRef<string>(generateSessionId());

  const sendMessage = useCallback(async (
    prompt: string,
    retryCount = 0,
    accumulatedMessage = ''
  ): Promise<void> => {
    if (!prompt?.trim()) {
      console.warn('Empty or invalid prompt provided');
      return;
    }

    setIsLoading(true);
    setError(null);

    const { idToken, accessToken } = await getAuthTokens();
    if (!idToken || !accessToken) {
      setError('認証トークンが取得できません');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/agent-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${idToken}`,
          'X-Access-Token': accessToken,
        },
        body: JSON.stringify({
          prompt,
        }),
      });

      if (!response.ok) {
        // 504 Gateway Timeout の場合は再接続を試行
        if (response.status === 504) {
          throw new Error('TIMEOUT_RETRY');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('レスポンスボディがありません');
      }

      // 初回または再接続時のメッセージスロット管理
      if (retryCount === 0) {
        setMessages(prev => [...prev, accumulatedMessage]);
      }

      await processStreamingResponse(
        response,
        // メッセージ更新時
        (currentMessage) => {
          const fullMessage = accumulatedMessage + currentMessage;
          setMessages(prev => [...prev.slice(0, -1), fullMessage]);
        },
        // 完了時
        (finalMessage) => {
          const fullMessage = accumulatedMessage + finalMessage;
          if (fullMessage) {
            setMessages(prev => [...prev.slice(0, -1), fullMessage]);
          } else {
            setMessages(prev => prev.slice(0, -1));
          }
        }
      );

    } catch (fetchError) {
      logError('SSE通信', fetchError);
      const errorDetails = getApiErrorDetails(fetchError);

      // タイムアウトエラーの場合は再接続
      if ((fetchError instanceof Error && fetchError.message === 'TIMEOUT_RETRY') ||
        errorDetails.message.includes('504') ||
        errorDetails.message.includes('timeout')) {

        if (retryCount < maxRetries) {
          console.log(`🔄 SSE reconnecting... (attempt ${retryCount + 1}/${maxRetries})`);

          // 現在のメッセージを保持して再接続
          const currentMessage = messages[messages.length - 1] || '';

          setTimeout(() => {
            sendMessage(prompt, retryCount + 1, currentMessage);
          }, 1000); // 1秒後に再接続
          return;
        }
      }

      // その他のエラーまたは最大再試行回数に達した場合
      if (retryCount < maxRetries && !(fetchError instanceof Error && fetchError.message.includes('TIMEOUT_RETRY'))) {
        setTimeout(() => {
          sendMessage(prompt, retryCount + 1, accumulatedMessage);
        }, retryDelay * Math.pow(2, retryCount));
      } else {
        setError(`通信エラー: ${errorDetails.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [getAuthTokens, maxRetries, retryDelay, messages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    sessionIdRef.current = generateSessionId();
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
  };
}