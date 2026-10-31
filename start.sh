#!/usr/bin/env bash
export PATH="/home/ken/.gemini/antigravity/scratch/node/bin:$PATH"
cd "$(dirname "$0")"

echo "=================================================="
echo "✨ Khởi chạy Live2D Idol & TikTok Live Bridge..."
echo "=================================================="

# 1. Khởi chạy TikTok Live Bridge Server (Cổng 5182)
node server/tiktok-server.js &
BRIDGE_PID=$!
echo "📡 TikTok Bridge Server đang chạy (PID: $BRIDGE_PID, Cổng: 5182)"

# Dọn dẹp tiến trình nền khi tắt
cleanup() {
  echo ""
  echo "🛑 Đang tắt các dịch vụ..."
  kill $BRIDGE_PID 2>/dev/null
  exit 0
}
trap cleanup EXIT INT TERM

# 2. Khởi chạy Vite Dev Server (Cổng 5180)
pnpm dev
