import streamlit as st
from sidebar import render_sidebar
from map import render_map, handle_map_click
from image_generator import process_image_generation

# 初期座標
INIT_LAT = 43.0683
INIT_LON = 141.3508

# 選択した座標を保存
if 'selected_location' not in st.session_state:
    st.session_state.selected_location = (INIT_LAT, INIT_LON)

# 地図を表示
map_data = render_map(st.session_state.selected_location)

# 地図のクリック処理
current_lat, current_lng = handle_map_click(map_data, st.session_state.selected_location)

# サイドバーのUI設定を取得
sidebar_settings = render_sidebar(current_lat, current_lng)

# 画像生成ボタンの処理
if st.sidebar.button("Step4. 画像を生成する"):
    if sidebar_settings["custom_prompt"].strip():
        success = process_image_generation(current_lat, current_lng, sidebar_settings)
    else:
        st.sidebar.warning("!! 追加の説明を入力してください。")