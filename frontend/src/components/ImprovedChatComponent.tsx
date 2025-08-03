'use client';

import React, { useState, useEffect } from 'react';
import { useSSEChat } from '@/hooks/useSSEChat';

export default function ImprovedChatComponent() {
  const [input, setInput] = useState('');
  const [allMessages, setAllMessages] = useState<Array<{ type: 'user' | 'ai', content: string }>>([]);

  const { messages, isLoading, error, sendMessage, clearMessages } = useSSEChat({
    maxRetries: 3,
    retryDelay: 1000,
  });

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const currentInput = input;
    setInput(''); // 入力をクリア

    // ユーザーメッセージを追加
    setAllMessages(prev => [...prev, { type: 'user', content: currentInput }]);

    // AIレスポンスを取得
    await sendMessage(currentInput);
  };

  // useSSEChatのmessages配列の変化を監視してallMessagesに反映
  useEffect(() => {
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];

      setAllMessages(prev => {
        // 最後のメッセージがAIメッセージかチェック
        const lastMessage = prev[prev.length - 1];

        if (lastMessage && lastMessage.type === 'ai') {
          // 既存のAIメッセージを更新
          return [...prev.slice(0, -1), { type: 'ai' as const, content: latestMessage }];
        } else {
          // 新しいAIメッセージを追加
          return [...prev, { type: 'ai' as const, content: latestMessage }];
        }
      });
    }
  }, [messages]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearMessages = () => {
    setAllMessages([]);
    clearMessages();
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg">
        {/* ヘッダー */}
        <div className="border-b p-4 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-gray-800">
            AI チャット
          </h1>
          <button
            onClick={handleClearMessages}
            className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors"
          >
            履歴クリア
          </button>
        </div>

        {/* メッセージエリア */}
        <div className="h-96 overflow-y-auto p-4 space-y-4">
          {allMessages.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              メッセージを入力してチャットを開始してください
            </div>
          ) : (
            allMessages.map((message, index) => (
              <div key={index} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`rounded-lg p-3 max-w-3xl ${message.type === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-blue-50'
                  }`}>
                  <div className={`text-sm mb-1 ${message.type === 'user'
                    ? 'text-blue-100'
                    : 'text-blue-600'
                    }`}>
                    {message.type === 'user' ? 'あなた' : 'AI'}
                  </div>
                  <div className={`whitespace-pre-wrap ${message.type === 'user'
                    ? 'text-white'
                    : 'text-gray-800'
                    }`}>
                    {message.content}
                    {/* ローディング中のカーソル */}
                    {isLoading && message.type === 'ai' && index === allMessages.length - 1 && (
                      <span className="animate-pulse">|</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}

          {/* エラー表示 */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-red-600 text-sm">
                ⚠️ {error}
              </div>
            </div>
          )}
        </div>

        {/* 入力エリア */}
        <div className="border-t p-4">
          <div className="flex gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="メッセージを入力... (Shift+Enterで改行)"
              rows={2}
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  送信中
                </div>
              ) : (
                '送信'
              )}
            </button>
          </div>

          {/* 接続状態表示 */}
          <div className="mt-2 text-xs text-gray-500">
            {isLoading ? (
              <span className="text-blue-600">● 接続中...</span>
            ) : error ? (
              <span className="text-red-600">● 接続エラー</span>
            ) : (
              <span className="text-green-600">● 準備完了</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}