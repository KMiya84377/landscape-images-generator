import { useAuthenticator } from '@aws-amplify/ui-react';
import { fetchAuthSession, fetchUserAttributes } from 'aws-amplify/auth';

export function useAuth() {
  // useAuthenticatorフックから認証情報を取得
  const { user, signOut } = useAuthenticator();
  
  // IDトークンを取得する関数（ユーザー認証用）
  const getIdToken = async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString();
    } catch (error) {
      console.error('IDトークン取得エラー:', error);
      return null;
    }
  };

  // アクセストークンを取得する関数（AgentCore Runtime認証用）
  const getAccessToken = async () => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString();
    } catch (error) {
      console.error('アクセストークン取得エラー:', error);
      return null;
    }
  };

  // 両方のトークンを取得する関数
  const getAuthTokens = async () => {
    try {
      const session = await fetchAuthSession();
      return {
        idToken: session.tokens?.idToken?.toString(),
        accessToken: session.tokens?.accessToken?.toString(),
      };
    } catch (error) {
      console.error('認証トークン取得エラー:', error);
      return { idToken: null, accessToken: null };
    }
  };

  // 後方互換性のため
  const getAuthToken = getIdToken;

  // ユーザー情報の詳細を取得する関数
  const getUserInfo = async () => {
    if (!user) return null;
    
    try {
      // Amplify Gen2では fetchUserAttributes を使用
      const attributes = await fetchUserAttributes();
      
      return {
        userId: user.userId,
        username: user.username,
        email: user.signInDetails?.loginId,
        // ユーザー属性（email, name等）
        attributes: attributes,
      };
    } catch (error) {
      console.error('ユーザー属性取得エラー:', error);
      return {
        userId: user.userId,
        username: user.username,
        email: user.signInDetails?.loginId,
        attributes: {},
      };
    }
  };

  return { 
    user, 
    signOut, 
    getAuthToken, // 後方互換性（IDトークン）
    getIdToken,
    getAccessToken,
    getAuthTokens,
    getUserInfo,
    isAuthenticated: !!user 
  };
}