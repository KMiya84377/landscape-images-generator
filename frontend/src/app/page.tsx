'use client';

import { useAuthenticator } from '@aws-amplify/ui-react';
import Header from '@/components/Header';
import ImprovedChatComponent from '@/components/ImprovedChatComponent';

export default function Home() {
  const { user } = useAuthenticator();

  // 認証済みの場合はチャット画面を表示
  if (user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <ImprovedChatComponent />
      </div>
    );
  }

  // 未認証の場合はウェルカム画面を表示
  // （AuthProviderが自動的に認証画面を表示）
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          AI チャットアプリ
        </h1>
        <p className="text-gray-600 mb-8">
          ログインしてAIとチャットを始めましょう
        </p>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
      </div>
    </div>
  );
}
