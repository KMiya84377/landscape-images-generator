import streamlit as st
import folium
from streamlit_folium import st_folium

def render_map(selected_location):
    """地図を描画し、クリックした座標を返す"""
    
    # 選択位置を地図の中心にする
    selected_lat, selected_lng = selected_location
    
    # 地図の選択位置とズーム値を設定
    map = folium.Map(
        location=[selected_lat, selected_lng], 
        zoom_start=15
    )

    # 選択位置にマーカーを追加
    folium.Marker(
        [selected_lat, selected_lng], 
        popup="選択位置",
        tooltip=f"緯度: {selected_lat:.6f}, 経度: {selected_lng:.6f}",
        icon=folium.Icon(color='blue', icon='star')
    ).add_to(map)

    # 地図を表示してクリック情報を取得
    map_data = st_folium(map, width=700, height=500)
    
    return map_data

def handle_map_click(map_data, selected_location):
    """地図のクリック情報を処理し、現在位置を返す"""
    
    # クリック情報を処理
    if map_data['last_clicked']:
        clicked_lat = map_data['last_clicked']['lat']
        clicked_lng = map_data['last_clicked']['lng']
        
        # 新しいクリック位置を保存（常に最新の1つのみ）
        new_location = (clicked_lat, clicked_lng)
        if new_location != selected_location:
            st.session_state.selected_location = new_location
            st.rerun()  # 地図を更新
        
        st.success(f"📍 クリック位置: 緯度 {clicked_lat:.6f}, 経度 {clicked_lng:.6f}")
        return clicked_lat, clicked_lng
    else:
        return selected_location
