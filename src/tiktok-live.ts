/**
 * TikTok Live Stream Interaction Engine for Live2D Idol
 * Connects via WebSocket to local TikTok Live Bridge Server (port 5182)
 */

interface StreamEvent {
  id: string
  type: 'chat' | 'gift' | 'like' | 'follow' | 'share' | 'member'
  user: string
  uniqueId?: string
  text?: string
  giftName?: string
  count?: number
  diamonds?: number
  likeCount?: number
  profilePictureUrl?: string
  giftPictureUrl?: string
  timestamp: number
}

let ws: WebSocket | null = null
let reconnectTimer: any = null
let isConnecting = false
let isConnected = false
let enableTts = true
let enableReactions = true
let enableBubbles = true
let enableParticles = true
let isObsMode = false

// Speech synthesis voice cache
let viVoice: SpeechSynthesisVoice | null = null

function initVoices() {
  if (!('speechSynthesis' in window)) return
  const voices = window.speechSynthesis.getVoices()
  viVoice = voices.find(v => v.lang.includes('vi') || v.lang.includes('VN')) || null
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = initVoices
  initVoices()
}

function speakText(text: string) {
  if (!enableTts || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    if (viVoice) utterance.voice = viVoice
    utterance.lang = 'vi-VN'
    utterance.rate = 1.05
    utterance.pitch = 1.15

    const idol = (window as any).idolApi
    if (idol?.setTalking) {
      idol.setTalking(true)
      utterance.onend = () => idol.setTalking(false)
      utterance.onerror = () => idol.setTalking(false)
    }

    window.speechSynthesis.speak(utterance)
  } catch (err) {
    console.warn('TTS error:', err)
  }
}

// 1. TẠO OVERLAY CHAT & PARTICLES TRÊN MÀN HÌNH
let overlayContainer: HTMLElement | null = null
let particlesContainer: HTMLElement | null = null

function ensureOverlay() {
  if (overlayContainer) return
  overlayContainer = document.createElement('div')
  overlayContainer.id = 'stream-overlay'
  overlayContainer.innerHTML = `
    <div id="stream-bubbles"></div>
    <div id="stream-gift-banner"></div>
    <div id="stream-particles"></div>
  `
  document.body.appendChild(overlayContainer)
  particlesContainer = document.getElementById('stream-particles')
}

// 2. HIỆU ỨNG TIM BAY & SPARKLES
function spawnHeartParticle(count = 1) {
  if (!enableParticles || !particlesContainer) return
  const colors = ['#ff2a5f', '#ff5983', '#ff85a2', '#ff007f', '#f43f5e', '#a855f7', '#38bdf8']

  for (let i = 0; i < count; i++) {
    const heart = document.createElement('div')
    heart.className = 'floating-heart'
    const size = Math.random() * 16 + 18
    const startX = window.innerWidth * 0.42 + (Math.random() - 0.5) * 260
    const startY = window.innerHeight * 0.65 + (Math.random() - 0.5) * 80
    const color = colors[Math.floor(Math.random() * colors.length)]
    const duration = Math.random() * 1.5 + 1.8

    heart.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`
    heart.style.left = `${startX}px`
    heart.style.top = `${startY}px`
    heart.style.animationDuration = `${duration}s`

    particlesContainer.appendChild(heart)
    setTimeout(() => heart.remove(), duration * 1000)
  }
}

function spawnGiftConfetti() {
  if (!enableParticles || !particlesContainer) return
  const colors = ['#f59e0b', '#ec4899', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#fbbf24']

  for (let i = 0; i < 35; i++) {
    const confetti = document.createElement('div')
    confetti.className = 'confetti-piece'
    const color = colors[Math.floor(Math.random() * colors.length)]
    confetti.style.backgroundColor = color
    confetti.style.left = `${window.innerWidth * 0.42 + (Math.random() - 0.5) * 400}px`
    confetti.style.top = `${window.innerHeight * 0.4}px`
    confetti.style.animationDuration = `${Math.random() * 1.8 + 1.2}s`
    confetti.style.transform = `rotate(${Math.random() * 360}deg)`

    particlesContainer.appendChild(confetti)
    setTimeout(() => confetti.remove(), 2500)
  }
}

// 3. HIỂN THỊ BONG BÓNG CHAT & THÔNG BÁO QUÀ
function showSpeechBubble(user: string, text: string, type: 'chat' | 'gift' | 'follow' = 'chat', avatar = '', subtext = '') {
  if (!enableBubbles) return
  ensureOverlay()
  const bubblesBox = document.getElementById('stream-bubbles')
  if (!bubblesBox) return

  const bubble = document.createElement('div')
  bubble.className = `stream-bubble bubble-${type}`

  const icon = type === 'gift' ? '🎁' : type === 'follow' ? '💖' : '💬'
  const avatarHtml = avatar
    ? `<img class="bubble-avatar" src="${avatar}" onerror="this.src=''"/>`
    : `<div class="bubble-avatar-placeholder">${icon}</div>`

  bubble.innerHTML = `
    ${avatarHtml}
    <div class="bubble-content">
      <div class="bubble-header">
        <span class="bubble-user">${escapeHtml(user)}</span>
        ${subtext ? `<span class="bubble-badge">${escapeHtml(subtext)}</span>` : ''}
      </div>
      <div class="bubble-text">${escapeHtml(text)}</div>
    </div>
  `

  bubblesBox.appendChild(bubble)

  // Giới hạn tối đa 3 bubble cùng lúc
  while (bubblesBox.children.length > 3) {
    bubblesBox.removeChild(bubblesBox.children[0])
  }

  setTimeout(() => {
    bubble.classList.add('fade-out')
    setTimeout(() => bubble.remove(), 350)
  }, 4500)
}

function showGiftBanner(user: string, giftName: string, count: number, diamonds: number, giftPic = '') {
  ensureOverlay()
  const bannerBox = document.getElementById('stream-gift-banner')
  if (!bannerBox) return

  const banner = document.createElement('div')
  banner.className = 'gift-banner-card'
  const picHtml = giftPic ? `<img class="gift-banner-img" src="${giftPic}" />` : '🎁'

  banner.innerHTML = `
    <div class="gift-banner-left">${picHtml}</div>
    <div class="gift-banner-center">
      <div class="gift-banner-title">CẢM ƠN QUÀ TẶNG! 🎉</div>
      <div class="gift-banner-desc"><b>${escapeHtml(user)}</b> đã tặng <b>${escapeHtml(giftName)}</b> x${count}</div>
    </div>
    <div class="gift-banner-right">+${diamonds} 💎</div>
  `

  bannerBox.innerHTML = ''
  bannerBox.appendChild(banner)
  spawnGiftConfetti()

  setTimeout(() => {
    banner.classList.add('fade-out')
    setTimeout(() => banner.remove(), 400)
  }, 5000)
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m] || m))
}

// 4. XỬ LÝ SỰ KIỆN LIVE VÀ TƯƠNG TÁC IDOL
function handleLiveEvent(evt: StreamEvent) {
  addEventToFeed(evt)
  const idol = (window as any).idolApi

  switch (evt.type) {
    case 'gift': {
      const giftName = evt.giftName || 'quà'
      const count = evt.count || 1
      const diamonds = evt.diamonds || count

      // Hiển thị banner quà
      showGiftBanner(evt.user, giftName, count, diamonds, evt.giftPictureUrl)

      // Idol phản ứng: má hồng, cười, nhảy mừng
      if (enableReactions && idol) {
        idol.triggerCheer ? idol.triggerCheer() : idol.setEmotion('blush')
      }

      // Giọng nói cảm ơn
      const ttsMessage = `Cảm ơn ${evt.user} đã gửi tặng ${giftName}!`
      speakText(ttsMessage)
      break
    }

    case 'chat': {
      showSpeechBubble(evt.user, evt.text || '', 'chat', evt.profilePictureUrl)

      if (enableReactions && idol) {
        idol.setEmotion('smile')
        idol.setTalking(true)
        setTimeout(() => {
          idol.setTalking(false)
          idol.setEmotion('neutral')
        }, 2200)
      }

      // Đọc tin nhắn chat nếu muốn
      // speakText(`${evt.user} nói: ${evt.text}`)
      break
    }

    case 'like': {
      const count = evt.likeCount || 5
      spawnHeartParticle(Math.min(12, Math.max(3, Math.floor(count / 3))))

      if (enableReactions && idol && Math.random() < 0.4) {
        idol.setEmotion('wink')
        setTimeout(() => idol.setEmotion('neutral'), 1500)
      }
      break
    }

    case 'follow': {
      showSpeechBubble(evt.user, 'vừa theo dõi phòng Live! 💖', 'follow', evt.profilePictureUrl, 'Mới Theo Dõi')
      spawnHeartParticle(6)

      if (enableReactions && idol) {
        idol.setEmotion('happy')
        idol.playMotion && idol.playMotion()
        setTimeout(() => idol.setEmotion('neutral'), 3000)
      }

      speakText(`Cảm ơn ${evt.user} đã theo dõi kênh!`)
      break
    }

    case 'share': {
      showSpeechBubble(evt.user, 'vừa chia sẻ phòng live! 🚀', 'follow')
      if (enableReactions && idol) {
        idol.setEmotion('happy')
      }
      break
    }
  }
}

// 5. THÊM SỰ KIỆN VÀO DANH SÁCH FEED TRÊN BẢNG ĐIỀU KHIỂN
function addEventToFeed(evt: StreamEvent) {
  const feedList = document.getElementById('tiktok-events-feed')
  if (!feedList) return

  const item = document.createElement('div')
  item.className = `feed-item feed-${evt.type}`

  let badge = '💬 Chat'
  let detail = `${escapeHtml(evt.user)}: ${escapeHtml(evt.text || '')}`

  if (evt.type === 'gift') {
    badge = '🎁 Quà'
    detail = `<b>${escapeHtml(evt.user)}</b> tặng <b>${escapeHtml(evt.giftName || '')}</b> x${evt.count} (+${evt.diamonds} 💎)`
  } else if (evt.type === 'like') {
    badge = '❤️ Thả Tim'
    detail = `<b>${escapeHtml(evt.user)}</b> đã thả +${evt.likeCount || 1} tim`
  } else if (evt.type === 'follow') {
    badge = '➕ Follow'
    detail = `<b>${escapeHtml(evt.user)}</b> đã follow phòng live`
  }

  const timeStr = new Date(evt.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  item.innerHTML = `
    <span class="feed-badge">${badge}</span>
    <span class="feed-text">${detail}</span>
    <span class="feed-time">${timeStr}</span>
  `

  feedList.insertBefore(item, feedList.firstChild)

  // Giữ tối đa 40 sự kiện gần nhất
  while (feedList.children.length > 40) {
    feedList.removeChild(feedList.lastChild!)
  }
}

// 6. KẾT NỐI WEBSOCKET TỚI TIKTOK BRIDGE SERVER
let tryDirectPort = false

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // Thử qua Vite proxy /ws trước (cùng cổng 5180), nếu lỗi thì thử cổng trực tiếp 5182
  const wsUrl = tryDirectPort
    ? `${protocol}//${window.location.hostname || 'localhost'}:5182`
    : `${protocol}//${window.location.host}/ws`

  updateConnectionStatus('connecting', `Đang kết nối tới Live Bridge (${wsUrl})...`)

  try {
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      console.log('[TikTok-Live-Client] Đã kết nối WebSocket Bridge thành công:', wsUrl)
      updateConnectionStatus('ready', 'Bridge Sẵn Sàng (Chưa vào phòng)')
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        handleBridgeMessage(payload)
      } catch (e) {
        console.error('Lỗi giải mã thông điệp:', e)
      }
    }

    ws.onerror = () => {
      console.warn('[TikTok-Live-Client] Lỗi kết nối WebSocket tới:', wsUrl)
      tryDirectPort = !tryDirectPort
    }

    ws.onclose = () => {
      updateConnectionStatus('disconnected', 'Mất kết nối Bridge. Tự động kết nối lại...')
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(initWebSocket, 3000)
      }
    }
  } catch (err) {
    console.warn('WebSocket init error:', err)
  }
}

function handleBridgeMessage(payload: any) {
  if (payload.type === 'status') {
    const data = payload.data || {}
    isConnected = !!data.isConnected
    isConnecting = !!data.isConnecting

    if (isConnected) {
      updateConnectionStatus('live', `Đang LIVE: @${data.username} (${data.viewerCount || 0} người xem)`)
      const btn = document.getElementById('btn-tiktok-connect') as HTMLButtonElement
      if (btn) btn.textContent = '⏹️ Ngắt Kết Nối'
    } else if (isConnecting) {
      updateConnectionStatus('connecting', `Đang kết nối @${data.username}...`)
    } else {
      updateConnectionStatus('ready', 'Đã ngắt kết nối (Sẵn sàng kết nối)')
      const btn = document.getElementById('btn-tiktok-connect') as HTMLButtonElement
      if (btn) btn.textContent = '▶️ Kết Nối Live'
    }
  } else if (payload.type === 'event') {
    handleLiveEvent({
      id: `${Date.now()}-${Math.random()}`,
      type: payload.eventType,
      ...payload.data,
    })
  } else if (payload.type === 'error') {
    const idol = (window as any).idolApi
    if (idol?.showToast) idol.showToast(payload.message, 'error')
    updateConnectionStatus('error', payload.message)
  } else if (payload.type === 'log') {
    const idol = (window as any).idolApi
    if (idol?.showToast) idol.showToast(payload.message, payload.level || 'info')
  }
}

function updateConnectionStatus(state: 'disconnected' | 'ready' | 'connecting' | 'live' | 'error', text: string) {
  const dot = document.getElementById('tiktok-status-dot')
  const label = document.getElementById('tiktok-status-text')

  if (dot) {
    dot.className = 'status-dot'
    if (state === 'live') dot.classList.add('live')
    else if (state === 'connecting') dot.classList.add('connecting')
    else if (state === 'ready') dot.classList.add('ready')
    else dot.classList.add('error')
  }

  if (label) {
    label.textContent = text
  }
}

// 7. GỬI LỆNH TỚI BRIDGE SERVER
function sendConnectCommand() {
  const input = document.getElementById('input-tiktok-username') as HTMLInputElement
  const rawUsername = input?.value.trim()
  if (!rawUsername) {
    alert('Vui lòng nhập TikTok Username (ví dụ: @tên_kênh)!')
    return
  }

  if (isConnected) {
    ws?.send(JSON.stringify({ action: 'disconnect' }))
  } else {
    ws?.send(JSON.stringify({ action: 'connect', username: rawUsername }))
  }
}

function sendSimulation(eventType: string, data: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'simulate',
      eventType,
      data,
    }))
  } else {
    // Nếu bridge server chưa mở, giả lập trực tiếp trên frontend!
    handleLiveEvent({
      id: `${Date.now()}`,
      type: eventType as any,
      ...data,
      timestamp: Date.now(),
    })
  }
}

// 8. CHẾ ĐỘ OBS STUDIO (TRANSPARENT OVERLAY)
export function toggleObsMode(activate?: boolean) {
  isObsMode = activate !== undefined ? activate : !isObsMode
  document.body.classList.toggle('obs-mode', isObsMode)

  const exitBtn = document.getElementById('obs-exit-banner')
  if (exitBtn) {
    exitBtn.style.display = isObsMode ? 'block' : 'none'
  }

  const idol = (window as any).idolApi
  if (idol?.showToast) {
    idol.showToast(
      isObsMode
        ? '🎥 Đã bật chế độ OBS Studio! Nhấn Esc hoặc click góc màn hình để thoát.'
        : 'Đã quay lại chế độ Live2D Studio bình thường.',
      'info'
    )
  }
}

// 9. THIẾT LẬP TOÀN BỘ SỰ KIỆN TIKTOK PANEL
export function setupTikTokLive() {
  ensureOverlay()
  initWebSocket()

  // Nút Kết Nối / Ngắt Kết Nối
  document.getElementById('btn-tiktok-connect')?.addEventListener('click', sendConnectCommand)

  // Nhấn Enter trong input username
  document.getElementById('input-tiktok-username')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendConnectCommand()
  })

  // Các nút giả lập (Simulation Buttons)
  document.getElementById('btn-sim-gift-rose')?.addEventListener('click', () => {
    sendSimulation('gift', { user: 'Hoàng Long', giftName: 'Hoa Hồng 🌹', count: 1, diamonds: 1 })
  })

  document.getElementById('btn-sim-gift-crown')?.addEventListener('click', () => {
    sendSimulation('gift', { user: 'Đại Gia 999', giftName: 'Vương Miện Vàng 👑', count: 1, diamonds: 500 })
  })

  document.getElementById('btn-sim-gift-galaxy')?.addEventListener('click', () => {
    sendSimulation('gift', { user: 'Super Fan VIP', giftName: 'Vũ Trụ Galaxy 🪐', count: 1, diamonds: 1000 })
  })

  document.getElementById('btn-sim-chat-1')?.addEventListener('click', () => {
    sendSimulation('chat', { user: 'Minh Thảo', comment: 'Idol ơi chào em đi ạ! Dễ thương quá ❤️' })
  })

  document.getElementById('btn-sim-chat-2')?.addEventListener('click', () => {
    sendSimulation('chat', { user: 'Tuấn Khang', comment: 'Bộ trang phục này xinh xỉu luôn idol ơi!' })
  })

  document.getElementById('btn-sim-like')?.addEventListener('click', () => {
    sendSimulation('like', { user: 'Khán giả tích cực', likeCount: 50 })
  })

  document.getElementById('btn-sim-follow')?.addEventListener('click', () => {
    sendSimulation('follow', { user: 'Ngọc Anh' })
  })

  // Cấu hình tuỳ chọn
  const chkTts = document.getElementById('chk-tiktok-tts') as HTMLInputElement
  chkTts?.addEventListener('change', () => { enableTts = chkTts.checked })

  const chkReaction = document.getElementById('chk-tiktok-reaction') as HTMLInputElement
  chkReaction?.addEventListener('change', () => { enableReactions = chkReaction.checked })

  const chkBubble = document.getElementById('chk-tiktok-bubble') as HTMLInputElement
  chkBubble?.addEventListener('change', () => { enableBubbles = chkBubble.checked })

  const chkParticles = document.getElementById('chk-tiktok-particles') as HTMLInputElement
  chkParticles?.addEventListener('change', () => { enableParticles = chkParticles.checked })

  // Nút OBS Mode
  document.getElementById('btn-tiktok-obs-mode')?.addEventListener('click', () => toggleObsMode(true))

  // Nút thoát OBS
  document.getElementById('obs-exit-banner')?.addEventListener('click', () => toggleObsMode(false))
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isObsMode) toggleObsMode(false)
  })

  // Tự động bật OBS mode nếu có URL query ?obs=true
  if (new URLSearchParams(window.location.search).get('obs') === 'true') {
    setTimeout(() => toggleObsMode(true), 500)
  }
}
