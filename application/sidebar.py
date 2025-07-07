import streamlit as st
import os

def render_sidebar(current_lat, current_lng):
    """サイドバーを描画し、画像生成の設定を取得する"""

    st.sidebar.subheader("Step1. 地図から座標を選んでね")

    st.sidebar.info(f"選択した座標: 緯度 {current_lat:.6f}, 経度 {current_lng:.6f}")

    st.sidebar.subheader("Step2. 詳細な設定を入力してね")

    image_style = st.sidebar.selectbox(
        "画像スタイル",
        ["リアル", "アニメ調", "水彩画", "油絵", "写真風", "イラスト"],
        index=0
    )

    time_of_day = st.sidebar.selectbox(
        "時間帯",
        ["現在の時間", "朝", "昼", "夕方", "夜"],
        index=0
    )

    weather = st.sidebar.selectbox(
        "天気",
        ["晴れ", "曇り", "雨", "雪", "霧"],
        index=0
    )

    custom_prompt = st.sidebar.text_area(
        "追加の説明",
        "美しい風景を生成してください",
        height=100
    )

    st.sidebar.subheader("Step3. 画像の保存先を入力してね")

    save_folder = st.sidebar.text_input(
        "保存先フォルダ",
        value=os.path.join(os.getcwd(), "outputs"),
        help="画像を保存するフォルダのパスを指定してください"
    )

    # フォルダが存在しない場合は作成するかどうかの選択
    create_folder = st.sidebar.checkbox(
        "フォルダが存在しない場合は作成する",
        value=True
    )

    # 保存先フォルダの状態を確認
    if save_folder:
        if os.path.exists(save_folder):
            st.sidebar.success(f"✅ フォルダが存在します: {save_folder}")
        else:
            if create_folder:
                st.sidebar.warning(f"⚠️ フォルダが存在しません。生成時に作成されます: {save_folder}")
            else:
                st.sidebar.error(f"❌ フォルダが存在しません: {save_folder}")

    # ファイル名の形式設定
    filename_format = st.sidebar.selectbox(
        "ファイル名の形式",
        [
            "coordinates_timestamp",
            "timestamp_only", 
            "coordinates_only",
            "custom"
        ],
        index=0,
        help="生成される画像のファイル名形式を選択してください"
    )

    # カスタムファイル名の設定
    if filename_format == "custom":
        custom_filename = st.sidebar.text_input(
            "カスタムファイル名",
            value="generated_image",
            help="拡張子は自動で付加されます"
        )
    else:
        custom_filename = None

    # 設定値を辞書で返す
    return {
        "image_style": image_style,
        "time_of_day": time_of_day,
        "weather": weather,
        "custom_prompt": custom_prompt,
        "save_folder": save_folder,
        "create_folder": create_folder,
        "filename_format": filename_format,
        "custom_filename": custom_filename
    }
