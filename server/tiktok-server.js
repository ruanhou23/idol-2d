import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { TikTokLiveConnection } from 'tiktok-live-connector'

const PORT = process.env.PORT || 5182
let currentConnection = null
let currentUsername = ''
let liveState = {
  isConnected: false,
  isConnecting: false,
  username: '',
  roomId: '',
  viewerCount: 0,
  error: null,
}

// HTTP server for health check & info
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({
    service: 'TikTok Live Stream Bridge for Live2D Idol',
    port: PORT,
    state: liveState,
  }))
})

// WebSocket Server
const wss = new WebSocketServer({ server })

function broadcast(payload) {
  const message = JSON.stringify(payload)
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })
}

function updateState(partial) {
  liveState = { ...liveState, ...partial }
  broadcast({ type: 'status', data: liveState })
}

// Disconnect helper
async function disconnectCurrent() {
  if (currentConnection) {
    try {
      currentConnection.disconnect()
    } catch (e) {
      console.warn('Disconnect error:', e.message)
    }
    currentConnection = null
  }
  updateState({
    isConnected: false,
    isConnecting: false,
    username: '',
    roomId: '',
    viewerCount: 0,
    error: null,
  })
}

// Connect helper
async function connectToTikTok(rawUsername, sessionId = '') {
  const username = rawUsername.replace(/^@/, '').trim()
  if (!username) {
    broadcast({ type: 'error', message: 'Tên người dùng TikTok không hợp lệ' })
    return
  }

  await disconnectCurrent()

  updateState({
    isConnecting: true,
    username,
    error: null,
  })

  console.log(`[TikTok-Bridge] Đang kết nối tới TikTok Live của @${username}...`)

  try {
    const options = {
      processInitialData: true,
      enableExtendedGiftInfo: true,
      clientParams: {},
    }

    if (sessionId) {
      options.sessionId = sessionId
    }

    const tiktokConn = new TikTokLiveConnection(username, options)
    currentConnection = tiktokConn
    currentUsername = username

    tiktokConn.on('connected', (state) => {
      console.log(`[TikTok-Bridge] Đã kết nối phòng Live: ${state?.roomId || 'OK'}`)
      updateState({
        isConnected: true,
        isConnecting: false,
        username,
        roomId: state?.roomId || '',
        viewerCount: state?.roomInfo?.user_count || 0,
      })
      broadcast({
        type: 'log',
        level: 'success',
        message: `Đã kết nối thành công với phòng live @${username}`,
      })
    })

    tiktokConn.on('disconnected', (info) => {
      console.log('[TikTok-Bridge] Đã ngắt kết nối:', info)
      updateState({
        isConnected: false,
        isConnecting: false,
      })
      broadcast({
        type: 'log',
        level: 'info',
        message: 'Đã ngắt kết nối khỏi phòng TikTok Live',
      })
    })

    tiktokConn.on('error', (err) => {
      console.error('[TikTok-Bridge] Lỗi kết nối:', err?.message || err)
      updateState({
        isConnecting: false,
        error: err?.message || 'Lỗi kết nối TikTok',
      })
      broadcast({
        type: 'error',
        message: `Lỗi kết nối @${username}: ${err?.message || err}`,
      })
    })

    // Chat Message
    tiktokConn.on('chat', (data) => {
      const user = data.nickname || data.uniqueId || 'Khách'
      const comment = data.comment || ''
      const profilePictureUrl = data.profilePictureUrl || data.user?.profilePictureUrl || ''
      console.log(`[Chat] ${user}: ${comment}`)
      broadcast({
        type: 'event',
        eventType: 'chat',
        data: {
          user,
          uniqueId: data.uniqueId,
          comment,
          profilePictureUrl,
          timestamp: Date.now(),
        },
      })
    })

    // Gift Event
    tiktokConn.on('gift', (data) => {
      const user = data.nickname || data.uniqueId || 'Khán giả'
      const giftName = data.giftName || data.giftDetails?.giftName || 'Món quà'
      const count = data.repeatCount || 1
      const diamonds = (data.diamondCount || 1) * count
      const giftPictureUrl = data.giftPictureUrl || data.giftDetails?.giftPictureUrl || ''
      const profilePictureUrl = data.profilePictureUrl || ''

      console.log(`[Gift] 🎁 ${user} gửi ${giftName} x${count} (${diamonds} 💎)`)
      broadcast({
        type: 'event',
        eventType: 'gift',
        data: {
          user,
          uniqueId: data.uniqueId,
          giftName,
          count,
          diamonds,
          giftPictureUrl,
          profilePictureUrl,
          timestamp: Date.now(),
        },
      })
    })

    // Like Event
    tiktokConn.on('like', (data) => {
      const user = data.nickname || data.uniqueId || 'Khán giả'
      const likeCount = data.likeCount || 1
      const totalLikes = data.totalLikes || 0
      broadcast({
        type: 'event',
        eventType: 'like',
        data: {
          user,
          uniqueId: data.uniqueId,
          likeCount,
          totalLikes,
          timestamp: Date.now(),
        },
      })
    })

    // Follow Event
    tiktokConn.on('follow', (data) => {
      const user = data.nickname || data.uniqueId || 'Khán giả'
      console.log(`[Follow] ➕ ${user} đã theo dõi!`)
      broadcast({
        type: 'event',
        eventType: 'follow',
        data: {
          user,
          uniqueId: data.uniqueId,
          timestamp: Date.now(),
        },
      })
    })

    // Share Event
    tiktokConn.on('share', (data) => {
      const user = data.nickname || data.uniqueId || 'Khán giả'
      broadcast({
        type: 'event',
        eventType: 'share',
        data: {
          user,
          uniqueId: data.uniqueId,
          timestamp: Date.now(),
        },
      })
    })

    // Room User / Viewer Count
    tiktokConn.on('roomUser', (data) => {
      if (data.viewerCount !== undefined) {
        updateState({ viewerCount: data.viewerCount })
      }
    })

    // Member Join
    tiktokConn.on('member', (data) => {
      const user = data.nickname || data.uniqueId || 'Khán giả'
      broadcast({
        type: 'event',
        eventType: 'member',
        data: {
          user,
          uniqueId: data.uniqueId,
          timestamp: Date.now(),
        },
      })
    })

    // Stream End
    tiktokConn.on('streamEnd', () => {
      console.log('[TikTok-Bridge] Buổi livestream đã kết thúc')
      updateState({ isConnected: false })
      broadcast({
        type: 'log',
        level: 'info',
        message: 'Buổi livestream đã kết thúc',
      })
    })

    await tiktokConn.connect()
  } catch (error) {
    console.error('[TikTok-Bridge] Không thể kết nối:', error.message)
    updateState({
      isConnecting: false,
      isConnected: false,
      error: error.message,
    })
    broadcast({
      type: 'error',
      message: `Kết nối thất bại: ${error.message}. Kênh có đang phát trực tiếp không?`,
    })
  }
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  // Send current state immediately on connect
  ws.send(JSON.stringify({ type: 'status', data: liveState }))

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      switch (msg.action) {
        case 'connect':
          await connectToTikTok(msg.username, msg.sessionId)
          break

        case 'disconnect':
          await disconnectCurrent()
          break

        case 'getStatus':
          ws.send(JSON.stringify({ type: 'status', data: liveState }))
          break

        case 'simulate':
          // Cho phép test mô phỏng sự kiện khi không livestream
          handleSimulation(msg.eventType, msg.data)
          break

        default:
          console.warn('Hành động không rõ:', msg.action)
      }
    } catch (e) {
      console.error('Lỗi phân tích WebSocket message:', e)
    }
  })
})

function handleSimulation(eventType, data) {
  const timestamp = Date.now()
  switch (eventType) {
    case 'gift':
      broadcast({
        type: 'event',
        eventType: 'gift',
        data: {
          user: data?.user || 'Thần Tài 99',
          uniqueId: data?.uniqueId || 'thantai99',
          giftName: data?.giftName || 'Hoa Hồng',
          count: data?.count || 1,
          diamonds: data?.diamonds || 1,
          giftPictureUrl: data?.giftPictureUrl || '',
          profilePictureUrl: '',
          timestamp,
        },
      })
      break

    case 'chat':
      broadcast({
        type: 'event',
        eventType: 'chat',
        data: {
          user: data?.user || 'Fan Cứng ❤️',
          uniqueId: data?.uniqueId || 'fancung',
          comment: data?.comment || 'Idol dễ thương quá đi mất!',
          profilePictureUrl: '',
          timestamp,
        },
      })
      break

    case 'like':
      broadcast({
        type: 'event',
        eventType: 'like',
        data: {
          user: data?.user || 'Người xem ẩn danh',
          likeCount: data?.likeCount || 15,
          totalLikes: (liveState.viewerCount || 100) + 15,
          timestamp,
        },
      })
      break

    case 'follow':
      broadcast({
        type: 'event',
        eventType: 'follow',
        data: {
          user: data?.user || 'Bạn mới gia nhập',
          uniqueId: 'new_follower',
          timestamp,
        },
      })
      break
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[TikTok-Bridge] Server đang chạy tại http://0.0.0.0:${PORT} (WebSocket sẵn sàng)`)
})
