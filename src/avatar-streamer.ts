/**
 * Avatar Live Streamer Engine for Live2D Idol
 * Unifies: Live2D Studio + TikTok Live Events + OBS Studio Overlay + Microphone Lip-Sync
 */

export interface AvatarState {
  currentEmote: string
  layout: 'corner-right' | 'corner-left' | 'center-bust' | 'full-body' | 'face-cam' | 'custom'
  bgMode: 'transparent' | 'green' | 'blue' | 'studio'
  isMicActive: boolean
  isObsMode: boolean
}

// Inter-tab / Inter-window Synchronization Channel
const syncChannel = 'BroadcastChannel' in window ? new BroadcastChannel('idol_avatar_sync') : null

// Audio / Microphone Lip-Sync state
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let micStream: MediaStream | null = null
let isMicActive = false
let micSensitivity = 1.4
let smoothedVolume = 0
let animFrameId: number | null = null

// Current Avatar Settings
let currentLayout: AvatarState['layout'] = 'corner-right'
let currentBgMode: AvatarState['bgMode'] = 'studio'

// 1. QUẢN LÝ MICROPHONE & KHẨU HÌNH LIÊN TỤC THEO GIỌNG NÓI
export async function toggleMicrophone(forceState?: boolean): Promise<boolean> {
  const targetState = forceState !== undefined ? forceState : !isMicActive

  if (targetState) {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Trình duyệt của bạn không hỗ trợ truy cập Micro.')
        return false
      }

      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = audioCtx.createMediaStreamSource(micStream)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.4
      source.connect(analyser)

      isMicActive = true
      startMicVolumeLoop()
      updateMicUI(true)

      const idol = (window as any).idolApi
      if (idol?.showToast) idol.showToast('🎙️ Micro Lip-Sync đã bật! Nói vào micro để Idol cử động miệng.', 'success')
      broadcastState({ isMicActive: true })
      return true
    } catch (err: any) {
      console.error('Lỗi truy cập Micro:', err)
      alert(`Không thể truy cập Microphone: ${err.message || err}`)
      isMicActive = false
      updateMicUI(false)
      return false
    }
  } else {
    // Tắt Micro
    if (animFrameId) cancelAnimationFrame(animFrameId)
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop())
      micStream = null
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {})
      audioCtx = null
    }
    isMicActive = false
    smoothedVolume = 0

    const idol = (window as any).idolApi
    if (idol?.setManualMouth) idol.setManualMouth(0)
    updateMicUI(false)

    if (idol?.showToast) idol.showToast('🔇 Đã tắt Micro Lip-Sync', 'info')
    broadcastState({ isMicActive: false })
    return false
  }
}

function startMicVolumeLoop() {
  if (!analyser || !isMicActive) return
  const dataArray = new Uint8Array(analyser.frequencyBinCount)

  function update() {
    if (!isMicActive || !analyser) return
    analyser.getByteFrequencyData(dataArray)

    // Tính âm lượng trung bình
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i]
    }
    const average = sum / dataArray.length

    // Ngưỡng lọc tiếng ồn nền (Noise Gate)
    const noiseThreshold = 14
    let targetVol = 0
    if (average > noiseThreshold) {
      targetVol = Math.min(1.0, ((average - noiseThreshold) / 45) * micSensitivity)
    }

    // Làm mượt cử động môi (Smoothing)
    smoothedVolume += (targetVol - smoothedVolume) * 0.35

    const idol = (window as any).idolApi
    if (idol?.setManualMouth) {
      idol.setManualMouth(smoothedVolume)
    }

    // Cập nhật thanh đo âm lượng UI
    const meter = document.getElementById('mic-level-bar')
    if (meter) {
      meter.style.width = `${Math.min(100, Math.round(smoothedVolume * 100))}%`
    }

    animFrameId = requestAnimationFrame(update)
  }

  update()
}

function updateMicUI(active: boolean) {
  const btn = document.getElementById('btn-toggle-mic')
  const badge = document.getElementById('mic-status-badge')
  if (btn) {
    btn.textContent = active ? '⏹️ Tắt Micro Lip-Sync' : '🎙️ Bật Micro Lip-Sync'
    btn.classList.toggle('primary', active)
  }
  if (badge) {
    badge.textContent = active ? 'Đang Lắng Nghe' : 'Đang Tắt'
    badge.className = active ? 'badge badge-success' : 'badge'
  }
}

// 2. BỐ CỤC AVATAR DÀNH CHO STREAMER (PRESET LAYOUTS)
export function applyAvatarLayout(preset: AvatarState['layout']) {
  currentLayout = preset
  const idol = (window as any).idolApi
  if (!idol?.setLayout) return

  const w = window.innerWidth
  const h = window.innerHeight

  switch (preset) {
    case 'corner-right':
      // Góc dưới bên phải (Chuẩn streamer chơi game/live bán hàng)
      idol.setLayout(0.95, w * 0.78, h * 0.78)
      break

    case 'corner-left':
      // Góc dưới bên trái
      idol.setLayout(0.95, w * 0.22, h * 0.78)
      break

    case 'center-bust':
      // Bán thân ở giữa (Just Chatting / Trò chuyện trực diện)
      idol.setLayout(1.35, w * 0.5, h * 0.65)
      break

    case 'face-cam':
      // Cận mặt biểu cảm cao
      idol.setLayout(2.2, w * 0.5, h * 0.95)
      break

    case 'full-body':
      // Toàn thân
      idol.setLayout(0.85, w * 0.5, h * 0.52)
      break

    case 'custom':
      idol.setLayout(1.0, w * 0.42, h * 0.52)
      break
  }

  // Cập nhật nút active
  document.querySelectorAll('[data-avatar-layout]').forEach((b) => {
    b.classList.toggle('primary', (b as HTMLElement).dataset.avatarLayout === preset)
  })

  broadcastState({ layout: preset })
}

// 3. MÀU NỀN OBS / CHROMA KEY
export function applyBackgroundMode(mode: AvatarState['bgMode']) {
  currentBgMode = mode
  document.body.classList.remove('bg-transparent', 'bg-green', 'bg-blue', 'bg-studio')

  if (mode === 'transparent') {
    document.body.classList.add('bg-transparent')
  } else if (mode === 'green') {
    document.body.classList.add('bg-green')
  } else if (mode === 'blue') {
    document.body.classList.add('bg-blue')
  } else {
    document.body.classList.add('bg-studio')
  }

  document.querySelectorAll('[data-avatar-bg]').forEach((b) => {
    b.classList.toggle('primary', (b as HTMLElement).dataset.avatarBg === mode)
  })

  broadcastState({ bgMode: mode })
}

// 4. PHÍM TẮT NHANH (HOTKEYS) CHO STREAMER
export function setupStreamerHotkeys() {
  window.addEventListener('keydown', (e) => {
    // Không bắt phím khi đang nhập vào input
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return

    const idol = (window as any).idolApi
    if (!idol) return

    switch (e.key) {
      case '1':
        idol.setEmotion('happy')
        broadcastState({ currentEmote: 'happy' })
        idol.showToast('😊 Biểu cảm: Vui vẻ', 'info', 1500)
        break

      case '2':
        idol.setEmotion('blush')
        broadcastState({ currentEmote: 'blush' })
        idol.showToast('😳 Biểu cảm: Má hồng ngại ngùng', 'info', 1500)
        break

      case '3':
        idol.setEmotion('wink')
        broadcastState({ currentEmote: 'wink' })
        idol.showToast('😉 Biểu cảm: Nháy mắt', 'info', 1500)
        break

      case '4':
        idol.setEmotion('sad')
        broadcastState({ currentEmote: 'sad' })
        idol.showToast('😢 Biểu cảm: U sầu', 'info', 1500)
        break

      case '5':
        idol.setEmotion('angry')
        broadcastState({ currentEmote: 'angry' })
        idol.showToast('😠 Biểu cảm: Giận dỗi', 'info', 1500)
        break

      case '0':
      case ' ':
        e.preventDefault()
        idol.setEmotion('neutral')
        broadcastState({ currentEmote: 'neutral' })
        idol.showToast('😐 Biểu cảm: Bình thường', 'info', 1200)
        break

      case 'm':
      case 'M':
        toggleMicrophone()
        break

      case 'v':
      case 'V':
        idol.playMotion && idol.playMotion()
        idol.showToast('👋 Động tác: Cử động', 'info', 1500)
        break
    }
  })
}

// 5. ĐỒNG BỘ ĐA CỬA SỔ (BROADCAST CHANNEL)
function broadcastState(partial: Partial<AvatarState>) {
  if (syncChannel) {
    syncChannel.postMessage({ type: 'AVATAR_SYNC', ...partial })
  }
}

export function initSyncListener() {
  if (!syncChannel) return
  syncChannel.onmessage = (event) => {
    const data = event.data
    if (!data || data.type !== 'AVATAR_SYNC') return

    const idol = (window as any).idolApi
    if (data.currentEmote && idol?.setEmotion) {
      idol.setEmotion(data.currentEmote)
    }
    if (data.layout) {
      applyAvatarLayout(data.layout)
    }
    if (data.bgMode) {
      applyBackgroundMode(data.bgMode)
    }
  }
}

// 6. KHỞI TẠO CÁC SỰ KIỆN TRÊN TAB AVATAR
export function setupAvatarStreamerUI() {
  initSyncListener()
  setupStreamerHotkeys()

  // Nút bật/tắt micro
  document.getElementById('btn-toggle-mic')?.addEventListener('click', () => {
    toggleMicrophone()
  })

  // Slider độ nhạy micro
  const sliderSensitivity = document.getElementById('slider-mic-sens') as HTMLInputElement
  const sensVal = document.getElementById('val-mic-sens')
  sliderSensitivity?.addEventListener('input', () => {
    micSensitivity = parseFloat(sliderSensitivity.value)
    if (sensVal) sensVal.textContent = micSensitivity.toFixed(1) + 'x'
  })

  // Các nút chọn bố cục Avatar (Layout Presets)
  document.querySelectorAll('[data-avatar-layout]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const layout = (e.currentTarget as HTMLElement).dataset.avatarLayout as AvatarState['layout']
      if (layout) applyAvatarLayout(layout)
    })
  })

  // Các nút chọn màu nền OBS
  document.querySelectorAll('[data-avatar-bg]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const bg = (e.currentTarget as HTMLElement).dataset.avatarBg as AvatarState['bgMode']
      if (bg) applyBackgroundMode(bg)
    })
  })

  // Nút sao chép URL OBS
  document.getElementById('btn-copy-obs-url')?.addEventListener('click', () => {
    const host = window.location.host
    const obsUrl = `http://${host}/?obs=true&layout=${currentLayout}&bg=${currentBgMode}`
    navigator.clipboard.writeText(obsUrl).then(() => {
      const idol = (window as any).idolApi
      if (idol?.showToast) idol.showToast('📋 Đã sao chép đường dẫn OBS Browser Source!', 'success')
    })
  })

  // Nút mở cửa sổ OBS Preview riêng biệt
  document.getElementById('btn-open-obs-preview')?.addEventListener('click', () => {
    const host = window.location.host
    const obsUrl = `http://${host}/?obs=true&layout=${currentLayout}&bg=${currentBgMode}`
    window.open(obsUrl, 'OBS_Idol_Preview', 'width=1080,height=1080,menubar=no,toolbar=no,location=no,status=no')
  })

  // Đọc các URL params khi khởi chạy (Ví dụ mở từ OBS)
  const params = new URLSearchParams(window.location.search)
  const isObs = params.get('obs') === 'true'
  const layoutParam = params.get('layout') as AvatarState['layout']
  const bgParam = params.get('bg') as AvatarState['bgMode']
  const autoMic = params.get('mic') === 'true'

  if (bgParam) {
    applyBackgroundMode(bgParam)
  } else if (isObs) {
    applyBackgroundMode('transparent')
  }

  if (layoutParam) {
    setTimeout(() => applyAvatarLayout(layoutParam), 400)
  }

  if (autoMic) {
    setTimeout(() => toggleMicrophone(true), 800)
  }
}
