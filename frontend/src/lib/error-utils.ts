/**
 * エラーハンドリング用のユーティリティ関数
 */

/**
 * unknown型のエラーからメッセージを安全に取得
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  
  return 'Unknown error occurred';
}

/**
 * エラーが特定の型かどうかを判定
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * エラーログを統一的に出力
 */
export function logError(context: string, error: unknown): void {
  const message = getErrorMessage(error);
  console.error(`[${context}] ${message}`, error);
}

/**
 * APIエラーの詳細情報を取得
 */
export function getApiErrorDetails(error: unknown): {
  message: string;
  status?: number;
  code?: string;
} {
  if (error instanceof Error) {
    // Fetch APIのエラーの場合
    if (error.message.includes('HTTP')) {
      const match = error.message.match(/HTTP (\d+):/);
      const status = match ? parseInt(match[1]) : undefined;
      return {
        message: error.message,
        status,
      };
    }
    
    return {
      message: error.message,
    };
  }
  
  return {
    message: getErrorMessage(error),
  };
}