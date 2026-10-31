#!/usr/bin/env bash
export PATH="/home/ken/.gemini/antigravity/scratch/node/bin:$PATH"
cd "$(dirname "$0")"

echo "=============================================="
echo "🚀 Hỗ Trợ Đẩy Code Lên GitHub (Git Push)"
echo "=============================================="

# Kiểm tra xem có truyền Token trực tiếp không
if [ -n "$1" ]; then
  TOKEN="$1"
  # Lấy remote origin hiện tại
  ORIGIN_URL=$(git remote get-url origin)
  # Chuyển đổi thành URL chứa token
  CLEAN_URL=$(echo "$ORIGIN_URL" | sed -E 's#https://([^@]+@)?github.com/#https://'${TOKEN}'@github.com/#')
  echo "📡 Đang đẩy code với GitHub Token..."
  git push "$CLEAN_URL" main
else
  echo "📡 Đang đẩy code lên remote origin..."
  git push origin main
fi
