# TikTokLive Python Connector cho Live2D Idol 🐍

Module kết nối sự kiện TikTok Live bằng Python sử dụng thư viện [isaackogan/TikTokLive](https://github.com/isaackogan/TikTokLive).

### Cài đặt thư viện Python:
```bash
pip install -r requirements.txt
```

### Chạy client:
1. Mở file `tiktok_live_bridge.py`, thay `TIKTOK_USERNAME = "tên_kênh_tiktok"`
2. Chạy lệnh:
```bash
python3 tiktok_live_bridge.py
```
Client sẽ tự động lắng nghe phòng live TikTok và đẩy sự kiện qua WebSocket tới Live2D Idol để nhân vật phản xạ theo thời gian thực!
