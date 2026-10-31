"""
TikTok Live Stream Connector (Python Version)
Sử dụng thư viện isaackogan/TikTokLive để bắt sự kiện Live và chuyển tiếp tới Live2D Idol.
"""

import asyncio
import json
from TikTokLive import TikTokLiveClient
from TikTokLive.events import ConnectEvent, CommentEvent, GiftEvent, LikeEvent, FollowEvent, ShareEvent
import websockets

BRIDGE_WS_URL = "ws://localhost:5182"
TIKTOK_USERNAME = "username_cua_ban"  # Thay bằng tên kênh TikTok Live của bạn

client: TikTokLiveClient = TikTokLiveClient(unique_id=f"@{TIKTOK_USERNAME}")
ws_connection = None

async def send_to_idol(event_type: str, data: dict):
    """Gửi sự kiện trực tiếp tới Live2D Idol qua WebSocket Bridge"""
    global ws_connection
    if ws_connection:
        try:
            msg = json.dumps({
                "action": "simulate",
                "eventType": event_type,
                "data": data
            })
            await ws_connection.send(msg)
        except Exception as e:
            print(f"[Error] Không thể gửi WebSocket: {e}")

@client.on(ConnectEvent)
async def on_connect(event: ConnectEvent):
    print(f"✅ Đã kết nối thành công với phòng live @{client.unique_id} (Room ID: {client.room_id})")

@client.on(CommentEvent)
async def on_comment(event: CommentEvent):
    print(f"💬 [Chat] {event.user.nickname}: {event.comment}")
    await send_to_idol("chat", {
        "user": event.user.nickname,
        "comment": event.comment
    })

@client.on(GiftEvent)
async def on_gift(event: GiftEvent):
    # Lọc quà tặng hoàn thành chuỗi combo
    if event.gift.streakable and not event.gift.streaking:
        print(f"🎁 [Gift] {event.user.nickname} gửi {event.gift.info.name} x{event.gift.count} ({event.gift.info.diamond_count * event.gift.count} 💎)")
        await send_to_idol("gift", {
            "user": event.user.nickname,
            "giftName": event.gift.info.name,
            "count": event.gift.count,
            "diamonds": event.gift.info.diamond_count * event.gift.count
        })
    elif not event.gift.streakable:
        print(f"🎁 [Gift] {event.user.nickname} gửi {event.gift.info.name} ({event.gift.info.diamond_count} 💎)")
        await send_to_idol("gift", {
            "user": event.user.nickname,
            "giftName": event.gift.info.name,
            "count": 1,
            "diamonds": event.gift.info.diamond_count
        })

@client.on(LikeEvent)
async def on_like(event: LikeEvent):
    print(f"❤️ [Like] {event.user.nickname} đã thả {event.count} tim (Tổng: {event.total})")
    await send_to_idol("like", {
        "user": event.user.nickname,
        "likeCount": event.count
    })

@client.on(FollowEvent)
async def on_follow(event: FollowEvent):
    print(f"➕ [Follow] {event.user.nickname} đã follow kênh!")
    await send_to_idol("follow", {
        "user": event.user.nickname
    })

async def main():
    global ws_connection
    print("🚀 Đang khởi động TikTokLive Python Client...")
    try:
        ws_connection = await websockets.connect(BRIDGE_WS_URL)
        print("🔗 Đã kết nối với Live2D Idol Bridge qua WebSocket!")
    except Exception as e:
        print(f"⚠️ Chưa kết nối được với WebSocket Idol: {e} (Chạy ở chế độ Console độc lập)")

    await client.start()

if __name__ == "__main__":
    asyncio.run(main())
