import * as PIXI from 'pixi.js'
import { Live2DModel, ZipLoader } from 'pixi-live2d-display/cubism4'
import JSZip from 'jszip'

// Expose PIXI to window for pixi-live2d-display
;(window as any).PIXI = PIXI

// Configure ZipLoader for .zip file loading
ZipLoader.zipReader = (data: Blob) => JSZip.loadAsync(data)

// 1. Khởi tạo Pixi Application
const canvas = document.getElementById('canvas') as HTMLCanvasElement
const statusText = document.getElementById('status-text') as HTMLSpanElement

const app = new PIXI.Application({
  view: canvas,
  resizeTo: window,
  backgroundColor: 0x11131f,
  autoDensity: true,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
})

// Wrapper container for applying filters reliably to Live2D
const stageContainer = new PIXI.Container()
app.stage.addChild(stageContainer)
stageContainer.filterArea = app.screen

// Color Matrix Filter for recoloring / themes
const colorFilter = new PIXI.filters.ColorMatrixFilter()
stageContainer.filters = [colorFilter]

let currentModel: Live2DModel | null = null
let baseScale = 1
let userScale = 1
let targetScale = 1
let isDragging = false
let dragStart = { x: 0, y: 0 }
let modelPosition = { x: window.innerWidth * 0.42, y: window.innerHeight * 0.52 }
let targetPosition = { x: window.innerWidth * 0.42, y: window.innerHeight * 0.52 }

// Mouse coordinates
let mousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 }

// Animation states
let lookAtEnabled = true
let blinkEnabled = true
let breathEnabled = true
let saccadeEnabled = true
let isTalking = false
let talkProgress = 0
let manualMouthOpen = 0

// Auto Blink variables
let blinkTimer = 0
let nextBlinkTime = 3
let isBlinking = false
let blinkProgress = 0

// Saccade variables (AIRI algorithm)
let saccadeTimer = 0
let nextSaccadeTime = 2
let saccadeOffset = { x: 0, y: 0 }

// Current Emotion
let currentEmote = 'neutral'

// Hair & Face manual tweaks
let hairParamFront = 0
let hairParamSide = 0
let hairParamBack = 0
let manualCheek = 0
let manualSmile = 0
let manualBrow = 0

// Angle Inspector (Xoay góc các bộ phận)
let lockAngle = false
let manualAngleX = 0
let manualAngleY = 0
let manualAngleZ = 0

// Current Arm Pose for models with alternate arms (Haru, Mao, Natori)
let currentArmPose = 'A'

// Hue Shift hiện tại của trang phục/nhân vật
let currentHueShift = 0

function applyHueShift(degrees: number) {
  currentHueShift = degrees
  colorFilter.reset()
  if (degrees !== 0) {
    colorFilter.hue(degrees, false)
  }
  const sliderHue = document.getElementById('slider-hue') as HTMLInputElement
  const hueVal = document.getElementById('hue-val') as HTMLSpanElement
  if (sliderHue) sliderHue.value = degrees.toString()
  if (hueVal) hueVal.textContent = `${degrees}°`
}

// Map lưu trữ trạng thái Part Opacity cho từng part ID
const partOpacities = new Map<string, number>()

// Dynamic Texture Canvas for AI Inpainting & Texture Overlays
let baseTextureCanvas: HTMLCanvasElement | null = null
let baseTextureCtx: CanvasRenderingContext2D | null = null
let originalTextureCanvas: HTMLCanvasElement | null = null
let uploadedAiImg: HTMLImageElement | null = null

// AI Part Default Coordinates on 2048x2048 Texture Atlas (Chuẩn 100% khớp Hiyori UV Mesh)
const AI_PART_DEFAULT_COORDS: Record<string, { x: number, y: number, w: number, h: number }> = {
  PartHairFront: { x: 750, y: 150, w: 450, h: 450 },
  PartHairBack: { x: 150, y: 1100, w: 850, h: 950 },
  PartBody: { x: 1150, y: 20, w: 550, h: 850 },
  PartArmA: { x: 1250, y: 880, w: 650, h: 800 },
  PartCheek: { x: 20, y: 1050, w: 400, h: 170 },
}

// Model library
const MODEL_PATHS: Record<string, string> = {
  hiyori: '/models/hiyori/hiyori_free_t08.model3.json',
  haru: '/models/Haru/Haru.model3.json',
  mao: '/models/Mao/Mao.model3.json',
  natori: '/models/Natori/Natori.model3.json',
  wanko: '/models/Wanko/Wanko.model3.json',
}

function setStatus(text: string) {
  if (statusText) statusText.textContent = text
}

// Hệ thống Toast Notification thông báo nổi bật
function showToast(text: string, type: 'success' | 'info' | 'error' = 'success', duration = 3500) {
  const container = document.getElementById('toast-container')
  if (!container) return

  const toast = document.createElement('div')
  toast.className = `toast ${type}`

  let icon = '✅'
  if (type === 'info') icon = 'ℹ️'
  if (type === 'error') icon = '⚠️'
  if (text.includes('🎉') || text.includes('🚀')) icon = '🎉'
  if (text.includes('📋')) icon = '📋'
  if (text.includes('💾')) icon = '💾'
  if (text.includes('↺')) icon = '↺'

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-text">${text}</span>
  `

  container.appendChild(toast)

  setTimeout(() => {
    toast.classList.add('fade-out')
    setTimeout(() => {
      toast.remove()
    }, 300)
  }, duration)
}

// 2. Tải Model Live2D
async function loadModel(source: string | File) {
  try {
    setStatus('Đang tải model...')
    if (currentModel) {
      stageContainer.removeChild(currentModel)
      currentModel.destroy({ children: true })
      currentModel = null
    }

    partOpacities.clear()

    const model = await Live2DModel.from(source, {
      autoInteract: false,
    })

    currentModel = model
    stageContainer.addChild(model)

    // Khởi tạo kích thước và căn giữa
    baseScale = Math.min((window.innerWidth * 0.72) / model.width, (window.innerHeight * 0.85) / model.height)
    userScale = 1
    targetScale = 1
    model.scale.set(baseScale * userScale)
    model.anchor.set(0.5, 0.5)

    modelPosition = { x: window.innerWidth * 0.42, y: window.innerHeight * 0.52 }
    targetPosition = { x: window.innerWidth * 0.42, y: window.innerHeight * 0.52 }
    model.position.set(modelPosition.x, modelPosition.y)

    // Lưu trạng thái Part Opacities ban đầu từ coreModel một cách an toàn
    const core = (model.internalModel as any).coreModel
    if (core) {
      const partIds: string[] = core._partIds || core._model?.parts?.ids || []
      for (const id of partIds) {
        const op = typeof core.getPartOpacityById === 'function' ? core.getPartOpacityById(id) : 1
        partOpacities.set(id, op)
      }
    }

    // Gắn hook 'beforeModelUpdate' - CHÌA KHÓA VÀNG để cập nhật param & part không bị overwrite
    model.internalModel.on('beforeModelUpdate', () => {
      onBeforeModelUpdate(model)
    })

    // Khởi tạo Canvas Texture cho tính năng ghép ảnh AI
    initTextureCanvases(model)

    // Phân loại và gán UI cho Parts & Motions
    categorizeAndRenderParts()
    setupMotionsUI(model)
    setupSoloPartDropdown()
    setupTextureAtlasInfo(model)

    // Reset các thanh trượt dáng tóc & biểu cảm
    resetTweaks()

    const modelName = typeof source === 'string' ? source.split('/').slice(-2)[0] || 'Model' : source.name
    setStatus(`Sẵn sàng: ${modelName}`)
  } catch (error: any) {
    console.error('Lỗi khi tải Live2D model:', error)
    setStatus(`Lỗi: ${error?.message || error}`)
  }
}

// Khởi tạo buffer Canvas cho texture atlas để ghép ảnh AI
function initTextureCanvases(model: Live2DModel) {
  if (!model.textures || model.textures.length === 0) return
  const baseTex = model.textures[0].baseTexture
  const source = (baseTex.resource as any)?.source || (baseTex.resource as any)?.url

  const img = new Image()
  img.crossOrigin = 'anonymous'

  if (typeof source === 'string') {
    img.src = source
  } else if (source instanceof HTMLImageElement && source.src) {
    img.src = source.src
  } else if ((baseTex.resource as any)?.url) {
    img.src = (baseTex.resource as any).url
  }

  img.onload = () => {
    const w = img.naturalWidth || 2048
    const h = img.naturalHeight || 2048

    baseTextureCanvas = document.createElement('canvas')
    baseTextureCanvas.width = w
    baseTextureCanvas.height = h
    baseTextureCtx = baseTextureCanvas.getContext('2d')!
    baseTextureCtx.drawImage(img, 0, 0)

    originalTextureCanvas = document.createElement('canvas')
    originalTextureCanvas.width = w
    originalTextureCanvas.height = h
    const origCtx = originalTextureCanvas.getContext('2d')!
    origCtx.drawImage(img, 0, 0)
  }
}

// 3. Vòng lặp cập nhật thông số ngay trước khi vẽ frame (beforeModelUpdate)
function onBeforeModelUpdate(model: Live2DModel) {
  const core = (model.internalModel as any).coreModel
  if (!core) return

  // 1. ÁP DỤNG TOÀN BỘ PART OPACITIES (QUẦN ÁO, TÓC, PHỤ KIỆN)
  partOpacities.forEach((opacity, partId) => {
    core.setPartOpacityById(partId, opacity)
  })

  // 2. XOAY GÓC BỘ PHẬN (ANGLE INSPECTOR)
  if (lockAngle) {
    core.setParameterValueById('ParamAngleX', manualAngleX)
    core.setParameterValueById('ParamAngleY', manualAngleY)
    core.setParameterValueById('ParamAngleZ', manualAngleZ)
    core.setParameterValueById('ParamBodyAngleX', manualAngleX * 0.35)
    core.setParameterValueById('ParamEyeBallX', manualAngleX / 40)
    core.setParameterValueById('ParamEyeBallY', manualAngleY / 40)
  }

  // 3. TỰ ĐỘNG CHỚP MẮT (BLINK)
  if (blinkEnabled && currentEmote !== 'wink') {
    if (isBlinking) {
      const eyeOpen = 1 - Math.sin(Math.PI * Math.min(1, blinkProgress))
      core.setParameterValueById('ParamEyeLOpen', eyeOpen)
      core.setParameterValueById('ParamEyeROpen', eyeOpen)
    }
  }

  // 4. NHỊP THỞ TỰ NHIÊN (BREATH)
  if (breathEnabled) {
    const breathVal = (Math.sin(Date.now() / 650) + 1) * 0.45
    core.setParameterValueById('ParamBreath', breathVal)
  }

  // 5. ĐẢO MẮT TỰ NHIÊN (SACCADE)
  if (saccadeEnabled && !lockAngle) {
    const curX = core.getParameterValueById('ParamEyeBallX')
    const curY = core.getParameterValueById('ParamEyeBallY')
    core.setParameterValueById('ParamEyeBallX', curX + saccadeOffset.x)
    core.setParameterValueById('ParamEyeBallY', curY + saccadeOffset.y)
  }

  // 6. KHẨU HÌNH MIỆNG / LIP-SYNC
  if (isTalking) {
    const simulatedMouth = (Math.sin(talkProgress) * 0.5 + 0.5) * (Math.sin(talkProgress * 0.4) * 0.5 + 0.5)
    core.setParameterValueById('ParamMouthOpenY', Math.min(1, simulatedMouth * 1.3))
  } else if (manualMouthOpen > 0) {
    core.setParameterValueById('ParamMouthOpenY', manualMouthOpen)
  }

  // 7. DÁNG TÓC & ĐỘ ĐUNG ĐƯA (HAIR SHAPE / PHYSICS)
  if (hairParamFront !== 0) core.setParameterValueById('ParamHairFront', hairParamFront)
  if (hairParamSide !== 0) core.setParameterValueById('ParamHairSide', hairParamSide)
  if (hairParamBack !== 0) core.setParameterValueById('ParamHairBack', hairParamBack)

  // 8. TINH CHỈNH BIỂU CẢM THỦ CÔNG
  if (manualCheek > 0) core.setParameterValueById('ParamCheek', manualCheek)
  if (manualSmile !== 0) {
    core.setParameterValueById('ParamEyeLSmile', Math.max(0, manualSmile))
    core.setParameterValueById('ParamEyeRSmile', Math.max(0, manualSmile))
    core.setParameterValueById('ParamMouthForm', manualSmile)
  }
  if (manualBrow !== 0) {
    core.setParameterValueById('ParamBrowLY', manualBrow)
    core.setParameterValueById('ParamBrowRY', manualBrow)
  }

  // 9. CÁC BIỂU CẢM CỐ ĐỊNH (EMOTION PRESETS)
  if (currentEmote === 'happy') {
    core.setParameterValueById('ParamEyeLSmile', 1)
    core.setParameterValueById('ParamEyeRSmile', 1)
    core.setParameterValueById('ParamMouthForm', 1)
    core.setParameterValueById('ParamCheek', 0.5)
  } else if (currentEmote === 'blush') {
    core.setParameterValueById('ParamCheek', 1)
    core.setParameterValueById('ParamEyeLSmile', 0.6)
    core.setParameterValueById('ParamEyeRSmile', 0.6)
  } else if (currentEmote === 'wink') {
    core.setParameterValueById('ParamEyeLOpen', 0)
    core.setParameterValueById('ParamEyeROpen', 1)
    core.setParameterValueById('ParamEyeLSmile', 1)
    core.setParameterValueById('ParamMouthForm', 0.8)
  } else if (currentEmote === 'sad') {
    core.setParameterValueById('ParamBrowLY', -0.8)
    core.setParameterValueById('ParamBrowRY', -0.8)
    core.setParameterValueById('ParamBrowLAngle', -0.6)
    core.setParameterValueById('ParamBrowRAngle', -0.6)
    core.setParameterValueById('ParamMouthForm', -1)
  } else if (currentEmote === 'angry') {
    core.setParameterValueById('ParamBrowLY', -0.5)
    core.setParameterValueById('ParamBrowRY', -0.5)
    core.setParameterValueById('ParamBrowLAngle', 0.8)
    core.setParameterValueById('ParamBrowRAngle', 0.8)
    core.setParameterValueById('ParamMouthForm', -0.6)
  }
}

// 4. Main Ticker tính toán thời gian và chuyển động mượt mà của Camera
app.ticker.add((delta) => {
  const dt = delta / 60

  // Chuyển động mượt mà của Camera (Lerp scale & position)
  if (currentModel) {
    userScale += (targetScale - userScale) * 0.14
    currentModel.scale.set(baseScale * userScale)

    modelPosition.x += (targetPosition.x - modelPosition.x) * 0.14
    modelPosition.y += (targetPosition.y - modelPosition.y) * 0.14
    currentModel.position.set(modelPosition.x, modelPosition.y)
  }

  // Blink logic timer
  if (blinkEnabled && currentEmote !== 'wink') {
    blinkTimer += dt
    if (!isBlinking && blinkTimer >= nextBlinkTime) {
      isBlinking = true
      blinkProgress = 0
    }
    if (isBlinking) {
      blinkProgress += dt / 0.16
      if (blinkProgress >= 1) {
        isBlinking = false
        blinkTimer = 0
        blinkProgress = 0
        nextBlinkTime = Math.random() * 3.5 + 1.5
      }
    }
  }

  // Saccade timer
  if (saccadeEnabled && !lockAngle) {
    saccadeTimer += dt
    if (saccadeTimer >= nextSaccadeTime) {
      saccadeTimer = 0
      nextSaccadeTime = Math.random() * 2 + 1
      saccadeOffset.x = (Math.random() - 0.5) * 0.35
      saccadeOffset.y = (Math.random() - 0.5) * 0.25
    }
  }

  // Lip-sync talking timer
  if (isTalking) {
    talkProgress += dt * 14
  }

  // Look-at mouse cursor (chỉ khi không khóa góc)
  if (lookAtEnabled && !lockAngle && currentModel) {
    currentModel.focus(mousePos.x, mousePos.y)
  }
})

// 5. Phân loại Parts thành: Kiểu Tóc vs Quần Áo
function categorizeAndRenderParts() {
  const outfitContainer = document.getElementById('outfit-parts-list')!
  const hairContainer = document.getElementById('hair-parts-list')!
  outfitContainer.innerHTML = ''
  hairContainer.innerHTML = ''

  if (!currentModel) return

  partOpacities.forEach((opacity, partId) => {
    const isHair = /hair|bang|pigtail|ponytail|front|side|back|发|髪/i.test(partId)
    const isOutfit = /body|arm|costume|cloth|dress|skirt|uniform|jacket|neck|slee|robe|hood|服|体|腕/i.test(partId)
    const isCoreOrFace = /core|face|cheek|brow|eye|nose|mouth|sketch|rough/i.test(partId)

    const row = document.createElement('div')
    row.className = 'part-item'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = opacity > 0.1
    checkbox.id = `part-${partId}`

    checkbox.onchange = () => {
      partOpacities.set(partId, checkbox.checked ? 1 : 0)
    }

    const label = document.createElement('label')
    label.htmlFor = checkbox.id
    label.textContent = partId
    label.style.flex = '1'
    label.style.cursor = 'pointer'

    row.appendChild(checkbox)
    row.appendChild(label)

    if (isHair) {
      hairContainer.appendChild(row)
    } else if (isOutfit || !isCoreOrFace) {
      outfitContainer.appendChild(row)
    }
  })

  if (hairContainer.children.length === 0) {
    hairContainer.innerHTML = '<div style="color: #64748b; font-size: 0.8rem; text-align: center;">Model này không có layer tóc riêng</div>'
  }
  if (outfitContainer.children.length === 0) {
    outfitContainer.innerHTML = '<div style="color: #64748b; font-size: 0.8rem; text-align: center;">Model này không có layer trang phục riêng</div>'
  }
}

// Đồng bộ lại trạng thái checkbox trên UI sau khi bấm nút preset
function updatePartsCheckboxes() {
  partOpacities.forEach((opacity, partId) => {
    const chk = document.getElementById(`part-${partId}`) as HTMLInputElement
    if (chk) {
      chk.checked = opacity > 0.1
    }
  })
}

// 6. Cập nhật menu Dropdown chọn Part để soi riêng (Solo Mode)
function setupSoloPartDropdown() {
  const select = document.getElementById('select-solo-part') as HTMLSelectElement
  if (!select) return
  select.innerHTML = '<option value="">-- Chọn Part để soi riêng --</option>'

  partOpacities.forEach((_, partId) => {
    const opt = document.createElement('option')
    opt.value = partId
    opt.textContent = partId
    select.appendChild(opt)
  })
}

// 7. Cập nhật thông tin và hình ảnh Texture Atlas gốc
function setupTextureAtlasInfo(model: Live2DModel) {
  const thumb = document.getElementById('atlas-thumb') as HTMLImageElement
  const fullImg = document.getElementById('atlas-full-img') as HTMLImageElement
  const dimLabel = document.getElementById('atlas-dim') as HTMLSpanElement

  if (model.textures && model.textures.length > 0) {
    const tex = model.textures[0]
    const baseTex = tex.baseTexture
    const source = (baseTex.resource as any)?.source || (baseTex.resource as any)?.url

    let url = ''
    if (typeof source === 'string') {
      url = source
    } else if (source instanceof HTMLImageElement && source.src) {
      url = source.src
    } else if (baseTex.resource && (baseTex.resource as any).url) {
      url = (baseTex.resource as any).url
    }

    if (url) {
      if (thumb) thumb.src = url
      if (fullImg) fullImg.src = url
    }
    if (dimLabel && baseTex.realWidth) {
      dimLabel.textContent = `${baseTex.realWidth} x ${baseTex.realHeight} px`
    }
  }
}

// 8. Lấy danh sách Motion động tác có sẵn
function setupMotionsUI(model: Live2DModel) {
  const select = document.getElementById('select-motion') as HTMLSelectElement
  select.innerHTML = '<option value="">-- Chọn động tác --</option>'

  const definitions = model.internalModel.motionManager.definitions
  if (!definitions) return

  Object.keys(definitions).forEach((group) => {
    const motionList = definitions[group]
    if (Array.isArray(motionList)) {
      motionList.forEach((_, idx) => {
        const opt = document.createElement('option')
        opt.value = `${group}:${idx}`
        opt.textContent = `${group} #${idx + 1}`
        select.appendChild(opt)
      })
    }
  })
}

// 9. Xử lý sự kiện chuột & tương tác kéo thả canvas
window.addEventListener('mousemove', (e) => {
  mousePos = { x: e.clientX, y: e.clientY }

  if (isDragging && currentModel) {
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    modelPosition.x += dx
    modelPosition.y += dy
    targetPosition.x += dx
    targetPosition.y += dy
    dragStart = { x: e.clientX, y: e.clientY }
    currentModel.position.set(modelPosition.x, modelPosition.y)
  }
})

canvas.addEventListener('mousedown', (e) => {
  isDragging = true
  dragStart = { x: e.clientX, y: e.clientY }
})

window.addEventListener('mouseup', () => {
  isDragging = false
})

canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.08 : 0.92
  targetScale = Math.min(3.5, Math.max(0.2, targetScale * factor))
})

// 10. Hệ thống Sinh Prompt cho AI (Gemini / Midjourney / DALL-E)
function generateAiPrompt() {
  const part = (document.getElementById('ai-part-select') as HTMLSelectElement)?.value || 'PartHairFront'
  const style = (document.getElementById('ai-style-select') as HTMLSelectElement)?.value || 'anime-school'
  const color = (document.getElementById('ai-color-select') as HTMLSelectElement)?.value || 'pastel-pink'

  const styleDescriptions: Record<string, string> = {
    'anime-school': 'modern Japanese anime high-school uniform aesthetic, neat and cute style',
    'gothic': 'gothic lolita style with black lace details, dark elegance ribbons',
    'cyberpunk': 'cyberpunk sci-fi aesthetic with neon accents and futuristic tech trims',
    'kimono': 'traditional Japanese kimono/yukata style with elegant floral patterns',
    'streetwear': 'modern trendy oversized streetwear hoodie and fashion accessories',
    'princess': 'royal princess fantasy aesthetic with luxurious gold trims and soft frills',
  }

  const colorDescriptions: Record<string, string> = {
    'pastel-pink': 'soft pastel pink and sakura rose tones with soft lighting',
    'navy-blue': 'deep navy blue and ocean azure tones with clean white highlights',
    'silver-white': 'shining silver white and platinum tones with subtle iridescent reflections',
    'midnight-black': 'deep midnight black and charcoal tones with crisp edges',
    'golden-blonde': 'radiant golden blonde and warm honey amber tones',
    'lavender': 'dreamy soft lavender purple and violet pastel tones',
  }

  let partPrompt = ''
  if (part === 'PartHairFront') {
    partPrompt = `Single isolated anime front bangs haircut layer, ${colorDescriptions[color]}, ${styleDescriptions[style]}, clean sharp anime lineart, cel-shaded, centered front view, flat 2D texture, transparent background PNG, no face, no eyes, no body, high resolution VTuber Live2D part asset --no background, no shadows`
  } else if (part === 'PartHairBack') {
    partPrompt = `Single isolated anime back long hair layer, ${colorDescriptions[color]}, ${styleDescriptions[style]}, symmetrical flowing hair strands, clean sharp anime lineart, cel-shaded, centered front view, flat 2D texture, transparent background PNG, no head, no body, high resolution VTuber Live2D part asset --no background`
  } else if (part === 'PartBody') {
    partPrompt = `Single isolated anime character outfit and torso asset, ${styleDescriptions[style]}, ${colorDescriptions[color]} color palette, front orthographic flat view, clean sharp anime lineart, flat cel-shading, transparent background PNG, no head, no face, no legs, isolated costume layer for Live2D rigging --no background`
  } else if (part === 'PartArmA') {
    partPrompt = `Single isolated pair of anime arms with matching ${styleDescriptions[style]} sleeves and hands, ${colorDescriptions[color]} theme, natural relaxed pose, front view, clean anime lineart, flat cel-shading, transparent background PNG, no body, no head, Live2D limb asset --no background`
  } else if (part === 'PartCheek') {
    partPrompt = `Pair of cute anime blush stickers, soft pastel peach pink gradient, anime diagonal blush lines, symmetrical, pure transparent background PNG, isolated facial effect for VTuber model --no background, no face`
  }

  const outputBox = document.getElementById('ai-prompt-output')
  if (outputBox) outputBox.textContent = partPrompt
}

// 10.B Sinh Master Prompt cho Gemini thiết kế Model Mới toàn diện
function generateMasterAiModelPrompt() {
  const charName = (document.getElementById('ai-model-name') as HTMLInputElement)?.value.trim() || 'Akira'
  const charTheme = (document.getElementById('ai-model-theme') as HTMLSelectElement)?.value || 'Anime High School Girl'
  const charHairColor = (document.getElementById('ai-model-hair-color') as HTMLSelectElement)?.value || 'Sakura Pastel Pink'
  const charHairDesc = (document.getElementById('ai-model-hair-desc') as HTMLInputElement)?.value.trim() || 'Twin-tails long hair with straight cute bangs'
  const charOutfitDesc = (document.getElementById('ai-model-outfit-desc') as HTMLInputElement)?.value.trim() || 'Modern sailor school uniform with cute neck ribbon'
  const charAccDesc = (document.getElementById('ai-model-acc-desc') as HTMLInputElement)?.value.trim() || 'Star hairpin clips and cat ears headband'
  const promptMode = (document.getElementById('ai-prompt-mode') as HTMLSelectElement)?.value || 'layers'

  let prompt = ''

  if (promptMode === 'concept') {
    prompt = `[MASTER CHARACTER CONCEPT ART FOR LIVE2D MODEL]
Character: ${charName} | Theme: ${charTheme}
Appearance Specifications:
- Hair: ${charHairDesc}, Hair Color: ${charHairColor}
- Outfit & Clothing: ${charOutfitDesc}
- Accessories & Face Features: ${charAccDesc}, expressive large anime eyes, delicate smiling lips
Art Direction:
- Clean Japanese anime game character illustration, high-definition 2D cel-shading, sharp lineart
- Full body standing straight A-pose / T-pose, orthographic front view, symmetrical silhouette
- Transparent background PNG (pure alpha), no 3D shading, no background scene
- Optimized as reference model sheet for VTuber / Live2D Cubism multi-layer mesh rigging.`
  } else if (promptMode === 'layers') {
    prompt = `[LIVE2D MULTI-LAYER ASSET GENERATION FOR GEMINI]
Generate 5 separate transparent PNG layers for character "${charName}" (${charTheme}, Hair: ${charHairColor}, Clothes: ${charOutfitDesc}):

Layer 1 (PartHairFront): Single isolated front bangs haircut layer, ${charHairDesc}, ${charHairColor}, clean anime lineart, cel-shaded, centered front view, transparent background PNG, no face, no eyes, no body.
Layer 2 (PartHairBack): Single isolated flowing back hair layer, ${charHairColor}, centered front view, transparent background PNG, no head, no body.
Layer 3 (PartBody): Single isolated character torso and outfit asset, ${charOutfitDesc}, front orthographic view, transparent background PNG, no head, no face, no legs.
Layer 4 (PartArmA): Single isolated pair of anime arms with matching sleeves and hands, natural pose, transparent background PNG, no body.
Layer 5 (PartCheek): Cute anime blush stickers and sparkles, transparent background PNG.
Negative Prompt: --no background, no shadows, no blurry lines, no crop.`
  } else if (promptMode === 'atlas') {
    prompt = `[MASTER LIVE2D 2048x2048 TEXTURE ATLAS SPECIFICATION FOR GEMINI]
You are a professional Live2D Cubism texture artist.
Generate a complete 2048x2048 RGBA Texture Atlas for character "${charName}" strictly adhering to the attached Live2D UV Blueprint Guide:
- Concept / Theme: ${charTheme}
- Hair Style & Color: ${charHairDesc} (${charHairColor})
- Costume & Outfit: ${charOutfitDesc}
- Face & Eyes: Radiant expressive anime eyes, ${charAccDesc}

MANDATORY CRITICAL CONSTRAINTS (DO NOT VIOLATE):
1. ALPHA TRANSPARENCY: The canvas MUST be a 32-bit RGBA PNG with 100% transparent background (Alpha = 0) for all unmapped/empty spaces. NO solid black background, NO white background, NO dark solid fill.
2. CHEEK BLUSH (CRITICAL): Draw only delicate soft pastel pink sakura blush gradients (#ff8da1) with 3 cute diagonal anime stripes. NEVER use black, dark gray, or muddy shadow colors for blush.
3. MOUTH (CRITICAL): Draw a clean, gentle anime closed smile (delicate upper lip contour and subtle lower lip peach accent). NEVER draw a gaping black circular mouth or solid black/white oval.
4. EYES: Crisp anime lineart, sparkling radiant iris, pure white sclera, sharp upper/lower eyelashes. NO dark circles, NO black eye bags.
5. STYLE: 2D Japanese anime cel-shading, clean sharp contours, flat color fills, no 3D photorealistic gradients.

PRECISE TEXTURE ATLAS ISLAND COORDINATES (2048x2048 px):
- [Box X:20, Y:0, W:450, H:580]   -> FaceSkin: Blank anime head silhouette and jawline (fair anime skin tone)
- [Box X:20, Y:580, W:450, H:280] -> Eyes & Eyebrows: Expressive anime eyes, iris, eyelashes, eyebrows
- [Box X:20, Y:880, W:350, H:160] -> Mouth: Closed smiling anime lips (clean lineart, peach pink lips)
- [Box X:20, Y:1050, W:400, H:170] -> Cheek Blush: Soft pastel pink anime blush stickers (#ff8da1), pure alpha transparency
- [Box X:150, Y:1100, W:850, H:950] -> HairBack: Flowing long back hair strands (${charHairColor})
- [Box X:750, Y:150, W:450, H:450] -> HairFront: Front bangs and side hair tufts (${charHairColor})
- [Box X:1150, Y:20, W:550, H:850] -> Body: Torso costume, blouse, collar, and skirt (${charOutfitDesc})
- [Box X:1250, Y:880, W:650, H:800] -> Arms: Pair of matching sleeves, cuffs, and hands
- [Box X:1600, Y:20, W:420, H:900] -> Legs: Legs and thigh-high socks

NEGATIVE PROMPT:
black background, dark background, opaque background, black circles under eyes, black blush, black smudges on cheeks, distorted open mouth, circular gaping hole, merged UV islands, blurry edges, photorealistic 3D, noise.`
  }

  const out = document.getElementById('ai-master-prompt-output')
  if (out) out.textContent = prompt
}

// 10.C Xuất file ảnh Texture Atlas Gốc (2048x2048 PNG)
function exportOriginalTexture() {
  const canvasToSave = originalTextureCanvas || baseTextureCanvas
  if (!canvasToSave) {
    showToast('Chưa tải xong texture của model!', 'error')
    return
  }
  const a = document.createElement('a')
  a.href = canvasToSave.toDataURL('image/png')
  a.download = 'live2d_texture_original_2048.png'
  a.click()
  setStatus('Đã xuất bản vẽ Texture Atlas gốc (2048x2048 PNG)')
  showToast('💾 Đã xuất Texture Gốc (2048x2048 PNG)!', 'success')
}

// 10.D Xuất Bản Đồ UV Blueprint phân vùng các Part (2048x2048 PNG)
function exportTextureBlueprint() {
  const srcCanvas = originalTextureCanvas || baseTextureCanvas
  if (!srcCanvas) {
    showToast('Chưa tải xong texture của model!', 'error')
    return
  }

  const w = srcCanvas.width || 2048
  const h = srcCanvas.height || 2048

  const bpCanvas = document.createElement('canvas')
  bpCanvas.width = w
  bpCanvas.height = h
  const ctx = bpCanvas.getContext('2d')!

  // 1. Nền tối kỹ thuật số (Slate Dark)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, w, h)

  // 2. Vẽ texture gốc mờ 38% để người dùng và AI nhận diện hình dạng gốc
  ctx.globalAlpha = 0.38
  ctx.drawImage(srcCanvas, 0, 0)
  ctx.globalAlpha = 1.0

  // 3. Vẽ ô lưới tọa độ Grid 256x256 px
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.font = 'bold 20px monospace'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'

  for (let x = 0; x <= w; x += 256) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.fillText(`${x}`, x + 6, 26)
  }
  for (let y = 0; y <= h; y += 256) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
    ctx.fillText(`${y}`, 6, y + 26)
  }

  // 4. Các Bounding Box phân vùng bộ phận chính xác 100% khớp Hiyori UV Mesh
  const regions = [
    { name: 'FaceSkin (Khuôn mặt & Cằm)', x: 20, y: 0, w: 450, h: 580, color: '#38bdf8' },
    { name: 'Eyes & Brows (Mắt & Lông mày)', x: 20, y: 580, w: 450, h: 280, color: '#00f5d4' },
    { name: 'Mouth (Khuôn miệng cười mỉm)', x: 20, y: 880, w: 350, h: 160, color: '#f59e0b' },
    { name: 'PartCheek (Má hồng phấn đào)', x: 20, y: 1050, w: 400, h: 170, color: '#f43f5e' },
    { name: 'PartHairFront (Tóc mái trước)', x: 750, y: 150, w: 450, h: 450, color: '#06b6d4' },
    { name: 'PartBody (Trang phục thân & Váy)', x: 1150, y: 20, w: 550, h: 850, color: '#eab308' },
    { name: 'Legs & Socks (Chân & Tất dài)', x: 1600, y: 20, w: 420, h: 900, color: '#8b5cf6' },
    { name: 'PartArmA (Cánh tay áo & Bàn tay)', x: 1250, y: 880, w: 650, h: 800, color: '#10b981' },
    { name: 'PartHairBack (Tóc dài sau)', x: 150, y: 1100, w: 850, h: 950, color: '#c084fc' },
  ]

  regions.forEach(reg => {
    // Viền Neon dày
    ctx.strokeStyle = reg.color
    ctx.lineWidth = 4
    ctx.strokeRect(reg.x, reg.y, reg.w, reg.h)

    // Highlight trong suốt
    ctx.fillStyle = reg.color
    ctx.globalAlpha = 0.12
    ctx.fillRect(reg.x, reg.y, reg.w, reg.h)
    ctx.globalAlpha = 1.0

    // Nhãn ghi chú
    const labelText = `${reg.name} [X:${reg.x}, Y:${reg.y}, ${reg.w}x${reg.h}px]`
    ctx.font = 'bold 22px sans-serif'
    const tw = ctx.measureText(labelText).width

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
    ctx.fillRect(reg.x, reg.y - 34, tw + 20, 34)

    ctx.fillStyle = reg.color
    ctx.fillText(labelText, reg.x + 10, reg.y - 9)
  })

  // 5. Banner hướng dẫn ở chân ảnh
  ctx.fillStyle = 'rgba(15, 23, 42, 0.95)'
  ctx.fillRect(0, h - 75, w, 75)
  ctx.font = 'bold 28px sans-serif'
  ctx.fillStyle = '#38bdf8'
  ctx.fillText('LIVE2D TEXTURE ATLAS BLUEPRINT UV GUIDE (2048x2048 px)', 30, h - 28)
  ctx.font = '20px sans-serif'
  ctx.fillStyle = '#94a3b8'
  ctx.fillText('Gửi ảnh này kèm Prompt cho Gemini để AI vẽ đè chuẩn xác tọa độ từng Part', 980, h - 28)

  const a = document.createElement('a')
  a.href = bpCanvas.toDataURL('image/png')
  a.download = 'live2d_texture_blueprint_uv_guide.png'
  a.click()
  setStatus('Đã xuất Bản Đồ UV Blueprint (2048x2048 PNG)')
  showToast('🗺️ Đã xuất Bản Đồ UV Blueprint (2048x2048 PNG)!', 'success')
}

// Tự động loại bỏ nền đen (Chroma Key) chuyển thành trong suốt RGBA
function filterBlackBackground(ctx: CanvasRenderingContext2D, width: number, height: number, threshold = 22) {
  try {
    const imgData = ctx.getImageData(0, 0, width, height)
    const d = imgData.data

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]
      const g = d[i + 1]
      const b = d[i + 2]

      if (r <= threshold && g <= threshold && b <= threshold) {
        d[i + 3] = 0
      } else if (r <= threshold + 14 && g <= threshold + 14 && b <= threshold + 14) {
        const maxVal = Math.max(r, g, b)
        const factor = (maxVal - threshold) / 14
        d[i + 3] = Math.min(255, Math.floor(d[i + 3] * factor))
      }
    }

    ctx.putImageData(imgData, 0, 0)
  } catch (e) {
    console.warn('Cannot filter black background:', e)
  }
}

// Cập nhật triệt để WebGL Texture trên GPU cho Live2D Model
function updateModelGpuTexture() {
  if (!currentModel || !baseTextureCanvas) return

  const baseTex = currentModel.textures[0]?.baseTexture
  if (baseTex) {
    if (baseTex.resource) {
      (baseTex.resource as any).source = baseTextureCanvas
    }
    baseTex.update()

    // Xóa cache _glTextures cũ để Pixi renderer buộc phải re-upload dữ liệu pixel mới lên WebGL
    const glId = (currentModel as any).glContextID
    if ((baseTex as any)._glTextures && (baseTex as any)._glTextures[glId]) {
      delete (baseTex as any)._glTextures[glId]
    }
  }

  // Đặt lại glContextID = -1 để cubism _render() tự động re-bind texture vào CoreModel
  ;(currentModel as any).glContextID = -1

  try {
    if (app.renderer && (app.renderer as any).texture && baseTex) {
      ;(app.renderer as any).texture.bind(baseTex, 0)
    }
  } catch (err) {
    console.warn('Renderer texture re-bind note:', err)
  }

  // Cập nhật thumbnail và ảnh trong modal xem toàn bộ texture
  const thumb = document.getElementById('atlas-thumb') as HTMLImageElement
  const fullImg = document.getElementById('atlas-full-img') as HTMLImageElement
  const dataUrl = baseTextureCanvas.toDataURL('image/png')
  if (thumb) thumb.src = dataUrl
  if (fullImg) fullImg.src = dataUrl
}

// 10.E Nạp toàn bộ file Texture Atlas mới (2048x2048) do Gemini tạo
function handleFullAtlasImport(file: File) {
  const reader = new FileReader()
  reader.onload = (e) => {
    const src = e.target?.result as string
    const img = new Image()
    img.src = src
    img.onload = () => {
      if (!baseTextureCanvas || !baseTextureCtx || !currentModel) return
      baseTextureCtx.clearRect(0, 0, baseTextureCanvas.width, baseTextureCanvas.height)
      baseTextureCtx.drawImage(img, 0, 0, baseTextureCanvas.width, baseTextureCanvas.height)

      const autoRemoveBlack = (document.getElementById('chk-auto-remove-black') as HTMLInputElement)?.checked ?? true
      if (autoRemoveBlack) {
        filterBlackBackground(baseTextureCtx, baseTextureCanvas.width, baseTextureCanvas.height, 22)
      }

      updateModelGpuTexture()

      setStatus(`Đã nạp toàn bộ Texture Atlas mới từ ${file.name} (${img.width}x${img.height})!`)
      showToast(`🎉 Nạp thành công toàn bộ Texture Atlas mới (${img.width}x${img.height})! Xem ngay trên nhân vật.`, 'success')
    }
  }
  reader.readAsDataURL(file)
}

// 11. Gắn Bộ Phận AI Vẽ Vào Texture Atlas
function applyAiPartToTexture() {
  if (!uploadedAiImg || !baseTextureCanvas || !baseTextureCtx || !currentModel) {
    showToast('Vui lòng kéo thả hoặc chọn ảnh PNG bộ phận trước!', 'error')
    return
  }

  const targetPart = (document.getElementById('ai-target-part') as HTMLSelectElement)?.value || 'PartHairFront'
  const offsetX = parseInt((document.getElementById('slider-ai-x') as HTMLInputElement)?.value || '0')
  const offsetY = parseInt((document.getElementById('slider-ai-y') as HTMLInputElement)?.value || '0')
  const scale = parseFloat((document.getElementById('slider-ai-scale') as HTMLInputElement)?.value || '1.0')

  const defaultCoords = AI_PART_DEFAULT_COORDS[targetPart] || { x: 800, y: 800, w: 500, h: 500 }

  const destW = defaultCoords.w * scale
  const destH = defaultCoords.h * scale
  const destX = defaultCoords.x + offsetX
  const destY = defaultCoords.y + offsetY

  // Vẽ đè ảnh AI lên Canvas Texture Atlas
  baseTextureCtx.drawImage(uploadedAiImg, destX, destY, destW, destH)

  // Cập nhật Texture GPU trong PixiJS & Cubism Core
  updateModelGpuTexture()

  setStatus(`Đã ghép thành công bộ phận AI vào: ${targetPart}!`)
  showToast(`✅ Đã gắn thành công bộ phận [${targetPart}]! Xem ngay trên nhân vật.`, 'success')
}

function resetAiTexture() {
  if (!originalTextureCanvas || !baseTextureCanvas || !baseTextureCtx || !currentModel) return
  baseTextureCtx.clearRect(0, 0, baseTextureCanvas.width, baseTextureCanvas.height)
  baseTextureCtx.drawImage(originalTextureCanvas, 0, 0)

  updateModelGpuTexture()

  setStatus('Đã khôi phục texture gốc của nhân vật')
  showToast('↺ Đã khôi phục texture gốc của nhân vật!', 'info')
}

// ==========================================
// 11.B HỆ THỐNG LƯU TRỮ MODEL TÙY BIẾN (INDEXEDDB)
// ==========================================
interface SavedCustomModel {
  id: string
  name: string
  characterKey: string
  textureDataUrl: string
  thumbDataUrl: string
  partOpacities: [string, number][]
  armPose?: string
  hueShift?: number
  createdAt: string
}

const DB_NAME = 'Live2DCustomizerDB'
const DB_VERSION = 1
const STORE_NAME = 'custom_models'

function openCustomModelsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('Trình duyệt không hỗ trợ IndexedDB'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result as IDBDatabase
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveCustomModelToDB(item: SavedCustomModel): Promise<void> {
  const db = await openCustomModelsDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(item)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function getAllCustomModelsFromDB(): Promise<SavedCustomModel[]> {
  try {
    const db = await openCustomModelsDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.warn('Cannot get custom models from DB:', e)
    return []
  }
}

async function deleteCustomModelFromDB(id: string): Promise<void> {
  const db = await openCustomModelsDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function generateModelThumbnail(): string {
  try {
    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = 96
    thumbCanvas.height = 96
    const ctx = thumbCanvas.getContext('2d')
    if (!ctx) return ''

    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, 96, 96)

    // Method 1: Pixi renderer extract
    if (app && app.renderer && (app.renderer as any).plugins?.extract && currentModel) {
      try {
        const pixiExtractCanvas = (app.renderer as any).plugins.extract.canvas(currentModel)
        if (pixiExtractCanvas && pixiExtractCanvas.width > 10 && pixiExtractCanvas.height > 10) {
          ctx.drawImage(pixiExtractCanvas, 0, 0, 96, 96)
          return thumbCanvas.toDataURL('image/png')
        }
      } catch (e) {
        // Fallback to baseTextureCanvas
      }
    }

    // Method 2: Crop face from baseTextureCanvas
    if (baseTextureCanvas) {
      ctx.drawImage(baseTextureCanvas, 10, 10, 480, 480, 0, 0, 96, 96)
      return thumbCanvas.toDataURL('image/png')
    }
  } catch (err) {
    console.warn('Thumbnail generation fallback:', err)
  }
  return baseTextureCanvas ? baseTextureCanvas.toDataURL('image/png') : ''
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function renderCustomModelsList() {
  const container = document.getElementById('custom-models-list')
  if (!container) return

  try {
    const models = await getAllCustomModelsFromDB()
    if (!models || models.length === 0) {
      container.innerHTML = `<div style="color: #64748b; font-size: 0.78rem; text-align: center; padding: 12px;">Chưa có model nào được lưu. Hãy nạp texture và bấm 'Lưu Model'!</div>`
      return
    }

    // Sắp xếp mới nhất lên đầu
    models.sort((a, b) => b.id.localeCompare(a.id))

    container.innerHTML = models.map((m) => `
      <div class="preset-item" data-id="${m.id}">
        <img class="preset-thumb" src="${m.thumbDataUrl || m.textureDataUrl}" alt="${escapeHtml(m.name)}" />
        <div class="preset-info">
          <div class="preset-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
          <div class="preset-date">🕒 ${m.createdAt || 'Vừa lưu'}</div>
        </div>
        <div class="preset-actions">
          <button class="primary btn-use-custom-model" data-id="${m.id}" title="Áp dụng model này để đổi quần áo & tóc">✨ Dùng</button>
          <button class="btn-delete-custom-model" data-id="${m.id}" title="Xóa model này" style="color: #f87171;">🗑️</button>
        </div>
      </div>
    `).join('')

    container.querySelectorAll('.btn-use-custom-model').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id
        const targetModel = models.find(m => m.id === id)
        if (targetModel) {
          await applySavedCustomModel(targetModel)
        }
      })
    })

    container.querySelectorAll('.btn-delete-custom-model').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = (e.currentTarget as HTMLElement).dataset.id
        const targetModel = models.find(m => m.id === id)
        if (!id) return
        if (confirm(`Bạn có chắc muốn xóa model [${targetModel?.name || id}] khỏi bộ sưu tập?`)) {
          await deleteCustomModelFromDB(id)
          await renderCustomModelsList()
          showToast('🗑️ Đã xóa model khỏi bộ sưu tập!', 'info')
        }
      })
    })
  } catch (err) {
    console.error('Cannot render custom models list:', err)
    container.innerHTML = `<div style="color: #ef4444; font-size: 0.78rem; padding: 8px;">Không thể tải danh sách model: ${String(err)}</div>`
  }
}

async function saveCurrentModelPreset(customName?: string) {
  if (!baseTextureCanvas || !currentModel) {
    showToast('⚠️ Chưa có model hoặc texture nào để lưu!', 'warning')
    return
  }

  const nameInput = document.getElementById('input-save-model-name') as HTMLInputElement
  const name = customName || nameInput?.value.trim() || `Model Tùy Biến (${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})`

  const selectChar = document.getElementById('select-character') as HTMLSelectElement
  const characterKey = selectChar?.value || 'hiyori'

  const textureDataUrl = baseTextureCanvas.toDataURL('image/png')
  const thumbDataUrl = generateModelThumbnail()
  const currentOpacities = Array.from(partOpacities.entries())

  const newModelItem: SavedCustomModel = {
    id: 'model_' + Date.now(),
    name,
    characterKey,
    textureDataUrl,
    thumbDataUrl,
    partOpacities: currentOpacities,
    armPose: currentArmPose,
    hueShift: currentHueShift,
    createdAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date().toLocaleDateString('vi-VN'),
  }

  try {
    await saveCustomModelToDB(newModelItem)
    if (nameInput) nameInput.value = ''
    await renderCustomModelsList()
    showToast(`💾 Đã lưu model [${name}] vào Bộ Sưu Tập thành công! Bạn có thể sang Tab 👗 Quần Áo hoặc 💇 Kiểu Tóc để tùy biến!`, 'success')
  } catch (err) {
    console.error('Save model failed:', err)
    showToast('❌ Không thể lưu model: ' + String(err), 'error')
  }
}

async function applySavedCustomModel(targetModel: SavedCustomModel) {
  if (!targetModel.textureDataUrl) return
  showToast(`⏳ Đang nạp model [${targetModel.name}]...`, 'info')

  const img = new Image()
  img.src = targetModel.textureDataUrl
  img.onload = () => {
    if (!baseTextureCanvas || !baseTextureCtx || !currentModel) return

    baseTextureCtx.clearRect(0, 0, baseTextureCanvas.width, baseTextureCanvas.height)
    baseTextureCtx.drawImage(img, 0, 0, baseTextureCanvas.width, baseTextureCanvas.height)

    // Khôi phục opacities đã lưu
    if (targetModel.partOpacities && targetModel.partOpacities.length > 0) {
      targetModel.partOpacities.forEach(([partId, op]) => {
        partOpacities.set(partId, op)
      })
      updatePartsCheckboxes()
    }

    if (targetModel.armPose) {
      currentArmPose = targetModel.armPose
    }

    if (targetModel.hueShift !== undefined) {
      applyHueShift(targetModel.hueShift)
    }

    // Cập nhật WebGL GPU tức thì
    updateModelGpuTexture()

    setStatus(`Đã nạp model [${targetModel.name}]!`)
    showToast(`✨ Đã nạp thành công [${targetModel.name}]! Bạn có thể sang Tab 👗 Quần Áo hoặc 💇 Kiểu Tóc để tùy biến tiếp!`, 'success')
  }
  img.onerror = () => {
    showToast('❌ Lỗi khi đọc dữ liệu texture của model đã lưu!', 'error')
  }
}

function restoreDefaultModel() {
  if (!originalTextureCanvas || !baseTextureCanvas || !baseTextureCtx || !currentModel) {
    showToast('⚠️ Không tìm thấy texture gốc để khôi phục!', 'warning')
    return
  }

  // Khôi phục texture nguyên bản
  baseTextureCtx.clearRect(0, 0, baseTextureCanvas.width, baseTextureCanvas.height)
  baseTextureCtx.drawImage(originalTextureCanvas, 0, 0)

  // Bật lại toàn bộ các bộ phận (trừ ArmB để giữ dáng ArmA mặc định)
  partOpacities.forEach((_, id) => {
    if (/ArmB|ArmLB|ArmRB/i.test(id)) {
      partOpacities.set(id, 0)
    } else {
      partOpacities.set(id, 1)
    }
  })
  currentArmPose = 'A'
  updatePartsCheckboxes()

  // Reset Hue shift
  applyHueShift(0)

  // Reset biểu cảm & miệng
  manualMouthOpen = 0
  manualSmile = 0
  manualBrow = 0
  manualCheek = 0
  isTalking = false

  updateModelGpuTexture()

  setStatus('Đã quay lại Model gốc mặc định ban đầu!')
  showToast('🔄 Đã quay lại Model gốc mặc định ban đầu thành công!', 'success')
}

// 12. Thiết lập toàn bộ sự kiện điều khiển UI
function initUIEvents() {
  // A. Tabs Navigation
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))

      const target = e.currentTarget as HTMLButtonElement
      target.classList.add('active')
      const tabId = target.dataset.tab!
      document.getElementById(tabId)?.classList.add('active')
    })
  })

  // B. Đổi Nhân Vật (Character Selector)
  const selectChar = document.getElementById('select-character') as HTMLSelectElement
  selectChar?.addEventListener('change', () => {
    const key = selectChar.value
    if (MODEL_PATHS[key]) {
      loadModel(MODEL_PATHS[key])
    }
  })

  // C. PRESETS KIỂU TÓC (Hairstyles)
  function setHairPreset(type: 'full' | 'bob' | 'pixie' | 'tied') {
    partOpacities.forEach((_, id) => {
      const isFront = /front|前发|前髪/i.test(id)
      const isSide = /side|侧发|横髪/i.test(id)
      const isBack = /back|后发|後ろ髪/i.test(id)

      if (isFront || isSide || isBack) {
        if (type === 'full') {
          partOpacities.set(id, 1)
        } else if (type === 'bob') {
          partOpacities.set(id, isBack ? 0 : 1)
        } else if (type === 'pixie') {
          partOpacities.set(id, isFront ? 1 : 0)
        } else if (type === 'tied') {
          partOpacities.set(id, isSide ? 0 : 1)
        }
      }
    })
    updatePartsCheckboxes()
  }

  function setActiveHairButton(activeBtn: HTMLElement) {
    ['btn-hair-full', 'btn-hair-bob', 'btn-hair-pixie', 'btn-hair-tied'].forEach((id) => {
      document.getElementById(id)?.classList.remove('primary')
    })
    activeBtn.classList.add('primary')
  }

  document.getElementById('btn-hair-full')?.addEventListener('click', (e) => {
    setHairPreset('full')
    setActiveHairButton(e.currentTarget as HTMLElement)
  })
  document.getElementById('btn-hair-bob')?.addEventListener('click', (e) => {
    setHairPreset('bob')
    setActiveHairButton(e.currentTarget as HTMLElement)
  })
  document.getElementById('btn-hair-pixie')?.addEventListener('click', (e) => {
    setHairPreset('pixie')
    setActiveHairButton(e.currentTarget as HTMLElement)
  })
  document.getElementById('btn-hair-tied')?.addEventListener('click', (e) => {
    setHairPreset('tied')
    setActiveHairButton(e.currentTarget as HTMLElement)
  })

  // Dáng tóc & độ đung đưa
  const sliderHairFront = document.getElementById('slider-hair-front') as HTMLInputElement
  const sliderHairSide = document.getElementById('slider-hair-side') as HTMLInputElement
  const sliderHairBack = document.getElementById('slider-hair-back') as HTMLInputElement

  sliderHairFront?.addEventListener('input', () => {
    hairParamFront = parseFloat(sliderHairFront.value)
    document.getElementById('val-hair-front')!.textContent = hairParamFront.toFixed(2)
  })
  sliderHairSide?.addEventListener('input', () => {
    hairParamSide = parseFloat(sliderHairSide.value)
    document.getElementById('val-hair-side')!.textContent = hairParamSide.toFixed(2)
  })
  sliderHairBack?.addEventListener('input', () => {
    hairParamBack = parseFloat(sliderHairBack.value)
    document.getElementById('val-hair-back')!.textContent = hairParamBack.toFixed(2)
  })

  // D. PRESETS QUẦN ÁO & TRANG PHỤC (Outfits)
  function setActiveOutfitButton(activeBtn: HTMLElement) {
    ['btn-outfit-full', 'btn-outfit-summer', 'btn-outfit-casual'].forEach((id) => {
      document.getElementById(id)?.classList.remove('primary')
    })
    activeBtn.classList.add('primary')
  }

  document.getElementById('btn-outfit-full')?.addEventListener('click', (e) => {
    partOpacities.forEach((_, id) => {
      if (/arm|body|cloth|dress|skirt|uniform|jacket|robe|hood|腕|服|体/i.test(id)) {
        if (/ArmB|ArmLB|ArmRB/i.test(id)) {
          partOpacities.set(id, 0)
        } else {
          partOpacities.set(id, 1)
        }
      }
    })
    currentArmPose = 'A'
    updatePartsCheckboxes()
    setActiveOutfitButton(e.currentTarget as HTMLElement)
  })

  document.getElementById('btn-outfit-summer')?.addEventListener('click', (e) => {
    partOpacities.forEach((_, id) => {
      if (/ArmA|ArmLA|ArmRA|ArmB|ArmLB|ArmRB|sleeve/i.test(id)) {
        partOpacities.set(id, 0)
      } else if (/body|cloth|dress|skirt|uniform|服|体/i.test(id)) {
        partOpacities.set(id, 1)
      }
    })
    updatePartsCheckboxes()
    setActiveOutfitButton(e.currentTarget as HTMLElement)
  })

  document.getElementById('btn-outfit-casual')?.addEventListener('click', (e) => {
    partOpacities.forEach((_, id) => {
      if (/neck|collar|ArmA|ArmLA|ArmRA|sleeve|jacket|robe/i.test(id)) {
        partOpacities.set(id, 0)
      } else if (/body|cloth|dress|skirt|uniform|服|体/i.test(id)) {
        partOpacities.set(id, 1)
      }
    })
    updatePartsCheckboxes()
    setActiveOutfitButton(e.currentTarget as HTMLElement)
  })

  document.getElementById('btn-outfit-switch-arms')?.addEventListener('click', () => {
    currentArmPose = currentArmPose === 'A' ? 'B' : 'A'
    partOpacities.forEach((_, id) => {
      if (/ArmA|ArmLA|ArmRA/i.test(id)) {
        partOpacities.set(id, currentArmPose === 'A' ? 1 : 0)
      } else if (/ArmB|ArmLB|ArmRB/i.test(id)) {
        partOpacities.set(id, currentArmPose === 'B' ? 1 : 0)
      }
    })
    updatePartsCheckboxes()
  })

  // E. BỘ ĐỔI MÀU TRANG PHỤC & BẢNG MÀU
  const sliderHue = document.getElementById('slider-hue') as HTMLInputElement

  sliderHue?.addEventListener('input', () => {
    const deg = parseInt(sliderHue.value)
    applyHueShift(deg)
  })

  document.querySelectorAll('.swatch').forEach((swatch) => {
    swatch.addEventListener('click', (e) => {
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'))
      const target = e.currentTarget as HTMLElement
      target.classList.add('active')
      const hue = parseInt(target.dataset.hue || '0')
      applyHueShift(hue)
    })
  })

  // F. BIỂU CẢM (EMOTIONS)
  document.querySelectorAll('[data-emote]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('[data-emote]').forEach(b => b.classList.remove('primary'))
      const target = e.currentTarget as HTMLButtonElement
      target.classList.add('primary')
      currentEmote = target.dataset.emote || 'neutral'
    })
  })

  const sliderCheek = document.getElementById('slider-cheek') as HTMLInputElement
  const sliderSmile = document.getElementById('slider-smile') as HTMLInputElement
  const sliderBrow = document.getElementById('slider-brow') as HTMLInputElement

  sliderCheek?.addEventListener('input', () => {
    manualCheek = parseFloat(sliderCheek.value)
    document.getElementById('val-cheek')!.textContent = manualCheek.toFixed(2)
  })
  sliderSmile?.addEventListener('input', () => {
    manualSmile = parseFloat(sliderSmile.value)
    document.getElementById('val-smile')!.textContent = manualSmile.toFixed(2)
  })
  sliderBrow?.addEventListener('input', () => {
    manualBrow = parseFloat(sliderBrow.value)
    document.getElementById('val-brow')!.textContent = manualBrow.toFixed(2)
  })

  // G. CÔNG TẮC ANIMATION
  const chkLookAt = document.getElementById('chk-lookat') as HTMLInputElement
  chkLookAt?.addEventListener('change', () => (lookAtEnabled = chkLookAt.checked))

  const chkBlink = document.getElementById('chk-blink') as HTMLInputElement
  chkBlink?.addEventListener('change', () => (blinkEnabled = chkBlink.checked))

  const chkBreath = document.getElementById('chk-breath') as HTMLInputElement
  chkBreath?.addEventListener('change', () => (breathEnabled = chkBreath.checked))

  const chkSaccade = document.getElementById('chk-saccade') as HTMLInputElement
  chkSaccade?.addEventListener('change', () => (saccadeEnabled = chkSaccade.checked))

  // H. LIP SYNC
  const sliderMouth = document.getElementById('slider-mouth') as HTMLInputElement
  const mouthVal = document.getElementById('mouth-val') as HTMLSpanElement
  sliderMouth?.addEventListener('input', () => {
    manualMouthOpen = parseFloat(sliderMouth.value)
    if (mouthVal) mouthVal.textContent = manualMouthOpen.toFixed(2)
  })

  const btnTalkDemo = document.getElementById('btn-talk-demo') as HTMLButtonElement
  btnTalkDemo?.addEventListener('click', () => {
    isTalking = !isTalking
    btnTalkDemo.textContent = isTalking ? '⏹️ Dừng nói' : '▶️ Test nói tự động (Auto Lip-Sync)'
    btnTalkDemo.classList.toggle('primary', isTalking)
    if (!isTalking && currentModel) {
      const core = (currentModel.internalModel as any).coreModel
      if (core) core.setParameterValueById('ParamMouthOpenY', 0)
    }
  })

  // I. MOTIONS
  const selectMotion = document.getElementById('select-motion') as HTMLSelectElement
  document.getElementById('btn-play-motion')?.addEventListener('click', () => {
    if (!currentModel || !selectMotion.value) return
    const [group, index] = selectMotion.value.split(':')
    currentModel.motion(group, parseInt(index))
  })

  // J. KÉO THẢ FILE .ZIP
  const dropZone = document.getElementById('drop-zone')!
  const fileInput = document.getElementById('file-input') as HTMLInputElement

  dropZone.addEventListener('click', () => fileInput.click())

  fileInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) loadModel(file)
  })

  ;['dragenter', 'dragover'].forEach((type) => {
    dropZone.addEventListener(type, (e) => {
      e.preventDefault()
      dropZone.style.borderColor = '#38bdf8'
    })
  })

  ;['dragleave', 'drop'].forEach((type) => {
    dropZone.addEventListener(type, (e) => {
      e.preventDefault()
      dropZone.style.borderColor = '#475569'
    })
  })

  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files[0]
    if (file && file.name.endsWith('.zip')) {
      loadModel(file)
    } else {
      alert('Vui lòng kéo thả file .zip chứa model Live2D!')
    }
  })

  // K. TAB 5: GÓC NHÌN & BỘ PHẬN GỐC (INSPECTOR)
  document.getElementById('btn-cam-face')?.addEventListener('click', () => {
    targetScale = 2.4
    targetPosition = { x: window.innerWidth * 0.42, y: window.innerHeight * 0.52 + 380 }
    setStatus('Góc xem: Cận mặt (Face Focus)')
  })

  document.getElementById('btn-cam-bust')?.addEventListener('click', () => {
    targetScale = 1.45
    targetPosition = { x: window.innerWidth * 0.42, y: window.innerHeight * 0.52 + 140 }
    setStatus('Góc xem: Thân trên (Upper Body)')
  })

  document.getElementById('btn-cam-body')?.addEventListener('click', () => {
    targetScale = 0.85
    targetPosition = { x: window.innerWidth * 0.42, y: window.innerHeight * 0.52 }
    setStatus('Góc xem: Toàn thân (Full Body)')
  })

  document.getElementById('btn-cam-reset')?.addEventListener('click', () => {
    targetScale = 1.0
    targetPosition = { x: window.innerWidth * 0.42, y: window.innerHeight * 0.52 }
    setStatus('Góc xem: Mặc định')
  })

  const chkLockAngle = document.getElementById('chk-lock-angle') as HTMLInputElement
  const sliderAngleX = document.getElementById('slider-angle-x') as HTMLInputElement
  const sliderAngleY = document.getElementById('slider-angle-y') as HTMLInputElement
  const sliderAngleZ = document.getElementById('slider-angle-z') as HTMLInputElement

  function updateAngleUI() {
    if (sliderAngleX) sliderAngleX.value = manualAngleX.toString()
    if (sliderAngleY) sliderAngleY.value = manualAngleY.toString()
    if (sliderAngleZ) sliderAngleZ.value = manualAngleZ.toString()

    document.getElementById('val-angle-x')!.textContent = `${manualAngleX}°`
    document.getElementById('val-angle-y')!.textContent = `${manualAngleY}°`
    document.getElementById('val-angle-z')!.textContent = `${manualAngleZ}°`
  }

  chkLockAngle?.addEventListener('change', () => {
    lockAngle = chkLockAngle.checked
    if (lockAngle) {
      updateAngleUI()
      setStatus('Đã khóa góc quay (tạm tắt nhìn theo chuột)')
    } else {
      setStatus('Đã mở khóa góc quay (theo con trỏ chuột)')
    }
  })

  function setAngles(x: number, y: number, z = 0) {
    manualAngleX = x
    manualAngleY = y
    manualAngleZ = z
    lockAngle = true
    if (chkLockAngle) chkLockAngle.checked = true
    updateAngleUI()
  }

  document.getElementById('btn-angle-left')?.addEventListener('click', () => setAngles(-28, 0))
  document.getElementById('btn-angle-right')?.addEventListener('click', () => setAngles(28, 0))
  document.getElementById('btn-angle-front')?.addEventListener('click', () => setAngles(0, 0, 0))
  document.getElementById('btn-angle-up')?.addEventListener('click', () => setAngles(0, 25))
  document.getElementById('btn-angle-down')?.addEventListener('click', () => setAngles(0, -25))

  sliderAngleX?.addEventListener('input', () => {
    manualAngleX = parseInt(sliderAngleX.value)
    lockAngle = true
    if (chkLockAngle) chkLockAngle.checked = true
    document.getElementById('val-angle-x')!.textContent = `${manualAngleX}°`
  })
  sliderAngleY?.addEventListener('input', () => {
    manualAngleY = parseInt(sliderAngleY.value)
    lockAngle = true
    if (chkLockAngle) chkLockAngle.checked = true
    document.getElementById('val-angle-y')!.textContent = `${manualAngleY}°`
  })
  sliderAngleZ?.addEventListener('input', () => {
    manualAngleZ = parseInt(sliderAngleZ.value)
    lockAngle = true
    if (chkLockAngle) chkLockAngle.checked = true
    document.getElementById('val-angle-z')!.textContent = `${manualAngleZ}°`
  })

  const selectSoloPart = document.getElementById('select-solo-part') as HTMLSelectElement
  document.getElementById('btn-part-solo')?.addEventListener('click', () => {
    const selected = selectSoloPart.value
    if (!selected) {
      alert('Vui lòng chọn một bộ phận trong danh sách!')
      return
    }

    partOpacities.forEach((_, id) => {
      partOpacities.set(id, id === selected ? 1 : 0)
    })
    updatePartsCheckboxes()
    setStatus(`Đang soi riêng bộ phận gốc: ${selected}`)
  })

  document.getElementById('btn-part-restore')?.addEventListener('click', () => {
    partOpacities.forEach((_, id) => {
      partOpacities.set(id, 1)
    })
    updatePartsCheckboxes()
    setStatus('Đã khôi phục hiển thị toàn bộ các bộ phận')
  })

  const modalAtlas = document.getElementById('modal-atlas')!
  ;['btn-open-atlas', 'btn-view-texture-part', 'btn-view-texture-model'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', () => {
      modalAtlas?.classList.add('open')
    })
  })
  document.getElementById('btn-close-atlas')?.addEventListener('click', () => {
    modalAtlas.classList.remove('open')
  })
  modalAtlas.addEventListener('click', (e) => {
    if (e.target === modalAtlas) {
      modalAtlas.classList.remove('open')
    }
  })

  // L. TAB 6: FORM TẠO PROMPT & GẮN ẢNH AI VẼ
  const aiPartSelect = document.getElementById('ai-part-select') as HTMLSelectElement
  const aiStyleSelect = document.getElementById('ai-style-select') as HTMLSelectElement
  const aiColorSelect = document.getElementById('ai-color-select') as HTMLSelectElement

  ;[aiPartSelect, aiStyleSelect, aiColorSelect].forEach((el) => {
    el?.addEventListener('change', generateAiPrompt)
  })

  generateAiPrompt()

  // Copy prompt từng part
  const btnCopyPrompt = document.getElementById('btn-copy-prompt') as HTMLButtonElement
  btnCopyPrompt?.addEventListener('click', () => {
    const text = document.getElementById('ai-prompt-output')?.textContent || ''
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        btnCopyPrompt.textContent = '✅ Đã sao chép vào bộ nhớ tạm!'
        showToast('📋 Đã sao chép prompt từng part vào bộ nhớ tạm!', 'success')
        setTimeout(() => {
          btnCopyPrompt.textContent = '📋 Sao Chép Prompt Từng Part'
        }, 2000)
      })
    }
  })

  // Upload ảnh từng bộ phận (Part) do AI vẽ
  const aiDropZone = document.getElementById('ai-drop-zone')!
  const aiFileInput = document.getElementById('ai-file-input') as HTMLInputElement
  const aiPreviewContainer = document.getElementById('ai-preview-container')!
  const aiImgPreview = document.getElementById('ai-img-preview') as HTMLImageElement

  aiDropZone?.addEventListener('click', () => aiFileInput.click())

  function handleAiImageFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const src = e.target?.result as string
      uploadedAiImg = new Image()
      uploadedAiImg.src = src
      uploadedAiImg.onload = () => {
        aiImgPreview.src = src
        aiPreviewContainer.style.display = 'flex'
        setStatus(`Đã tải ảnh bộ phận: ${file.name} (${uploadedAiImg!.width}x${uploadedAiImg!.height})`)
        showToast(`🖼️ Đã nạp ảnh bộ phận (${uploadedAiImg!.width}x${uploadedAiImg!.height}px), sẵn sàng căn chỉnh!`, 'info')
      }
    }
    reader.readAsDataURL(file)
  }

  aiFileInput?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) handleAiImageFile(file)
  })

  ;['dragenter', 'dragover'].forEach((type) => {
    aiDropZone?.addEventListener(type, (e) => {
      e.preventDefault()
      aiDropZone.style.borderColor = '#38bdf8'
    })
  })

  ;['dragleave', 'drop'].forEach((type) => {
    aiDropZone?.addEventListener(type, (e) => {
      e.preventDefault()
      aiDropZone.style.borderColor = '#475569'
    })
  })

  aiDropZone?.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files[0]
    if (file && file.type.startsWith('image/')) {
      handleAiImageFile(file)
    }
  })

  // Tinh chỉnh tọa độ và độ lớn ảnh bộ phận
  const sliderAiX = document.getElementById('slider-ai-x') as HTMLInputElement
  const sliderAiY = document.getElementById('slider-ai-y') as HTMLInputElement
  const sliderAiScale = document.getElementById('slider-ai-scale') as HTMLInputElement

  sliderAiX?.addEventListener('input', () => {
    document.getElementById('val-ai-x')!.textContent = `${sliderAiX.value}px`
  })
  sliderAiY?.addEventListener('input', () => {
    document.getElementById('val-ai-y')!.textContent = `${sliderAiY.value}px`
  })
  sliderAiScale?.addEventListener('input', () => {
    document.getElementById('val-ai-scale')!.textContent = `${parseFloat(sliderAiScale.value).toFixed(2)}x`
  })

  // Nút Áp dụng và Khôi phục ảnh bộ phận
  document.getElementById('btn-apply-ai-part')?.addEventListener('click', applyAiPartToTexture)
  document.getElementById('btn-reset-ai-texture')?.addEventListener('click', resetAiTexture)

  // Nút Xuất Texture Gốc & Bản Đồ UV Blueprint (từ các vị trí trên giao diện)
  ;['btn-download-raw-texture', 'btn-export-raw-tex-ai', 'btn-modal-dl-raw'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', exportOriginalTexture)
  })
  ;['btn-download-blueprint', 'btn-export-blueprint-ai', 'btn-modal-dl-blueprint'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', exportTextureBlueprint)
  })

  // Xử lý nạp Toàn Bộ Texture Atlas Mới trong Tab 8
  const fullAtlasDropZone = document.getElementById('full-atlas-drop-zone')
  const fullAtlasInput = document.getElementById('full-atlas-file-input') as HTMLInputElement
  const fullAtlasPreviewContainer = document.getElementById('full-atlas-preview-container')
  const fullAtlasPreviewImg = document.getElementById('full-atlas-preview-img') as HTMLImageElement
  const fullAtlasDim = document.getElementById('full-atlas-dim')
  let pendingFullAtlasImg: HTMLImageElement | null = null

  fullAtlasDropZone?.addEventListener('click', () => fullAtlasInput?.click())

  function handleFullAtlasFileSelection(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const src = e.target?.result as string
      pendingFullAtlasImg = new Image()
      pendingFullAtlasImg.src = src
      pendingFullAtlasImg.onload = () => {
        if (fullAtlasPreviewImg) fullAtlasPreviewImg.src = src
        if (fullAtlasDim) fullAtlasDim.textContent = `${pendingFullAtlasImg!.width} x ${pendingFullAtlasImg!.height} px`
        if (fullAtlasPreviewContainer) fullAtlasPreviewContainer.style.display = 'flex'
        showToast(`🖼️ Đã chọn Texture Atlas (${pendingFullAtlasImg!.width}x${pendingFullAtlasImg!.height}px). Bấm Áp Dụng để nạp!`, 'info')
      }
    }
    reader.readAsDataURL(file)
  }

  fullAtlasInput?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) handleFullAtlasFileSelection(file)
  })

  ;['dragenter', 'dragover'].forEach((type) => {
    fullAtlasDropZone?.addEventListener(type, (e) => {
      e.preventDefault()
      if (fullAtlasDropZone) fullAtlasDropZone.style.borderColor = '#f472b6'
    })
  })

  ;['dragleave', 'drop'].forEach((type) => {
    fullAtlasDropZone?.addEventListener(type, (e) => {
      e.preventDefault()
      if (fullAtlasDropZone) fullAtlasDropZone.style.borderColor = '#475569'
    })
  })

  fullAtlasDropZone?.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files[0]
    if (file && file.type.startsWith('image/')) {
      handleFullAtlasFileSelection(file)
    }
  })

  document.getElementById('btn-apply-full-atlas')?.addEventListener('click', () => {
    if (!pendingFullAtlasImg || !baseTextureCanvas || !baseTextureCtx || !currentModel) {
      showToast('Vui lòng chọn file Texture Atlas trước!', 'error')
      return
    }

    baseTextureCtx.clearRect(0, 0, baseTextureCanvas.width, baseTextureCanvas.height)
    baseTextureCtx.drawImage(pendingFullAtlasImg, 0, 0, baseTextureCanvas.width, baseTextureCanvas.height)

    const autoRemoveBlack = (document.getElementById('chk-auto-remove-black') as HTMLInputElement)?.checked ?? true
    if (autoRemoveBlack) {
      filterBlackBackground(baseTextureCtx, baseTextureCanvas.width, baseTextureCanvas.height, 22)
    }

    updateModelGpuTexture()

    setStatus('Đã áp dụng toàn bộ Texture Atlas mới!')
    showToast('🎉 Nạp thành công toàn bộ Texture Atlas mới! Xem ngay trên nhân vật.', 'success')
  })

  // Nút Áp Dụng và Lưu Ngay Vào Bộ Sưu Tập Model
  document.getElementById('btn-apply-and-save-atlas')?.addEventListener('click', async () => {
    if (!pendingFullAtlasImg || !baseTextureCanvas || !baseTextureCtx || !currentModel) {
      showToast('Vui lòng chọn file Texture Atlas trước!', 'error')
      return
    }

    baseTextureCtx.clearRect(0, 0, baseTextureCanvas.width, baseTextureCanvas.height)
    baseTextureCtx.drawImage(pendingFullAtlasImg, 0, 0, baseTextureCanvas.width, baseTextureCanvas.height)

    const autoRemoveBlack = (document.getElementById('chk-auto-remove-black') as HTMLInputElement)?.checked ?? true
    if (autoRemoveBlack) {
      filterBlackBackground(baseTextureCtx, baseTextureCanvas.width, baseTextureCanvas.height, 22)
    }

    updateModelGpuTexture()

    const nameInput = document.getElementById('input-save-model-name') as HTMLInputElement
    const customName = nameInput?.value.trim() || `Model Mới (${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })})`
    await saveCurrentModelPreset(customName)
  })

  // Nạp nhanh mẫu Cô Bé Tóc Vàng đã khử sạch nền đen
  document.getElementById('btn-load-blonde-preset')?.addEventListener('click', () => {
    const presetImg = new Image()
    presetImg.src = '/models/hiyori/texture_girl_transparent_2048.png'
    presetImg.onload = () => {
      if (!baseTextureCanvas || !baseTextureCtx || !currentModel) return
      baseTextureCtx.clearRect(0, 0, baseTextureCanvas.width, baseTextureCanvas.height)
      baseTextureCtx.drawImage(presetImg, 0, 0, baseTextureCanvas.width, baseTextureCanvas.height)

      updateModelGpuTexture()
      setStatus('Đã áp dụng mẫu Cô Bé Tóc Vàng (đã khử sạch nền đen)!')
      showToast('🎉 Đã nạp thành công mẫu Cô Bé Tóc Vàng! Đã khử sạch 100% lỗi mảng đen.', 'success')
    }
  })

  // Sửa lỗi má hồng và khuôn môi (Xóa 2 vết đen ở má & làm mịn môi)
  function fixBlushAndMouthFeatures() {
    if (!currentModel || !baseTextureCanvas || !baseTextureCtx) {
      showToast('Chưa có model đang hoạt động!', 'error')
      return
    }

    // 1. Xóa các vết đốm đen mà AI vẽ nhầm vào vùng má hồng của Hiyori (X: 0..400, Y: 1050..1220)
    baseTextureCtx.clearRect(0, 1050, 400, 170)

    // 2. Vẽ 2 vệt má hồng phấn đào anime tinh tế (Sakura Peach Blush)
    function drawBlushSpot(cx: number, cy: number, rx: number, ry: number) {
      const grad = baseTextureCtx!.createRadialGradient(cx, cy, 2, cx, cy, rx)
      grad.addColorStop(0, 'rgba(255, 120, 155, 0.85)')
      grad.addColorStop(0.5, 'rgba(255, 160, 185, 0.45)')
      grad.addColorStop(1, 'rgba(255, 180, 200, 0)')

      baseTextureCtx!.save()
      baseTextureCtx!.fillStyle = grad
      baseTextureCtx!.beginPath()
      baseTextureCtx!.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      baseTextureCtx!.fill()

      // 3 vạch chéo má hồng anime dễ thương
      baseTextureCtx!.strokeStyle = 'rgba(255, 90, 130, 0.65)'
      baseTextureCtx!.lineWidth = 3
      for (let offset = -18; offset <= 18; offset += 18) {
        baseTextureCtx!.beginPath()
        baseTextureCtx!.moveTo(cx + offset - 8, cy + 12)
        baseTextureCtx!.lineTo(cx + offset + 8, cy - 12)
        baseTextureCtx!.stroke()
      }
      baseTextureCtx!.restore()
    }

    drawBlushSpot(90, 1135, 75, 45)
    drawBlushSpot(270, 1135, 75, 45)

    // 3. Khôi phục lại khuôn miệng mịn màng thanh tú của Hiyori từ originalTextureCanvas (X: 0..350, Y: 880..1050)
    if (originalTextureCanvas) {
      baseTextureCtx.clearRect(0, 880, 350, 170)
      baseTextureCtx.drawImage(originalTextureCanvas, 0, 880, 350, 170, 0, 880, 350, 170)
    }

    // 4. Khóa miệng khép cười mỉm tự nhiên
    manualMouthOpen = 0
    manualSmile = 0.4
    isTalking = false

    const core = (currentModel.internalModel as any).coreModel
    if (core) {
      core.setParameterValueById('ParamMouthOpenY', 0)
      core.setParameterValueById('ParamMouthForm', 0.4)
      core.setParameterValueById('ParamCheek', 0.8)
    }

    // Đảm bảo bật PartCheek hiển thị má hồng mới
    partOpacities.set('PartCheek', 1)

    // 5. Cập nhật GPU WebGL tức thì
    updateModelGpuTexture()

    setStatus('Đã sửa sạch 2 vết đen ở má & làm mịn khuôn môi cười xinh xắn!')
    showToast('✨ Đã sửa sạch 2 vết đen ở má & làm mịn môi cười xinh xắn!', 'success')
  }

  // Gắn sự kiện các nút sửa mặt
  ;['btn-fix-face-features', 'btn-fix-face-quick'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', fixBlushAndMouthFeatures)
  })

  document.getElementById('btn-toggle-cheek-part')?.addEventListener('click', () => {
    const current = partOpacities.get('PartCheek') ?? 1
    const newOp = current > 0.1 ? 0 : 1
    partOpacities.set('PartCheek', newOp)
    updatePartsCheckboxes()
    showToast(newOp === 0 ? '🚫 Đã ẩn lớp má hồng' : '💖 Đã bật lại lớp má hồng', 'info')
  })

  document.getElementById('btn-restore-natural-mouth')?.addEventListener('click', () => {
    manualMouthOpen = 0
    manualSmile = 0.45
    isTalking = false
    const core = (currentModel?.internalModel as any)?.coreModel
    if (core) {
      core.setParameterValueById('ParamMouthOpenY', 0)
      core.setParameterValueById('ParamMouthForm', 0.45)
    }
    const sliderSmile = document.getElementById('slider-smile') as HTMLInputElement
    if (sliderSmile) sliderSmile.value = '0.45'
    showToast('💋 Đã khép miệng cười mỉm tự nhiên!', 'success')
  })

  document.getElementById('btn-reset-full-atlas')?.addEventListener('click', () => {
    resetAiTexture()
    if (fullAtlasPreviewContainer) fullAtlasPreviewContainer.style.display = 'none'
    pendingFullAtlasImg = null
  })

  // Nút chuyển đổi nhanh các nhân vật trong Tab 8
  const quickChars: Record<string, string> = {
    'btn-quick-char-hiyori': 'hiyori',
    'btn-quick-char-haru': 'haru',
    'btn-quick-char-mao': 'mao',
    'btn-quick-char-natori': 'natori',
  }
  Object.entries(quickChars).forEach(([btnId, charKey]) => {
    document.getElementById(btnId)?.addEventListener('click', () => {
      if (MODEL_PATHS[charKey]) {
        const selectChar = document.getElementById('select-character') as HTMLSelectElement
        if (selectChar) selectChar.value = charKey
        loadModel(MODEL_PATHS[charKey])
        showToast(`🚀 Đã chuyển sang model [${charKey.toUpperCase()}] thành công!`, 'success')
      }
    })
  })

  // Form Thiết Kế Model Live2D Mới Toàn Diện Cho Gemini
  const masterFormIds = [
    'ai-model-name',
    'ai-model-theme',
    'ai-model-hair-color',
    'ai-model-hair-desc',
    'ai-model-outfit-desc',
    'ai-model-acc-desc',
    'ai-prompt-mode',
  ]
  masterFormIds.forEach((id) => {
    const el = document.getElementById(id)
    if (el) {
      el.addEventListener('input', generateMasterAiModelPrompt)
      el.addEventListener('change', generateMasterAiModelPrompt)
    }
  })
  generateMasterAiModelPrompt()

  const btnCopyMasterPrompt = document.getElementById('btn-copy-master-prompt') as HTMLButtonElement
  btnCopyMasterPrompt?.addEventListener('click', () => {
    const text = document.getElementById('ai-master-prompt-output')?.textContent || ''
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        btnCopyMasterPrompt.textContent = '✅ Đã sao chép Master Prompt!'
        showToast('📋 Đã sao chép Master Prompt cho Gemini vào bộ nhớ tạm!', 'success')
        setTimeout(() => {
          btnCopyMasterPrompt.textContent = '📋 Sao Chép Master Prompt Cho Gemini'
        }, 2000)
      })
    }
  })

  // Nút Xuất Texture Atlas đã ghép
  document.getElementById('btn-export-texture')?.addEventListener('click', () => {
    if (!baseTextureCanvas) return
    const a = document.createElement('a')
    a.href = baseTextureCanvas.toDataURL('image/png')
    a.download = 'texture_00_custom.png'
    a.click()
    showToast('💾 Đã tải về file Texture Atlas mới!', 'success')
  })

  // 12.B Sự Kiện Bộ Sưu Tập Model Của Tôi (Lưu Model, Khôi phục Model gốc)
  document.getElementById('btn-save-current-model')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('input-save-model-name') as HTMLInputElement
    const customName = nameInput?.value.trim()
    await saveCurrentModelPreset(customName)
  })

  // Nút lưu nhanh từ Tab Quần Áo và Tab Kiểu Tóc
  document.getElementById('btn-quick-save-outfit')?.addEventListener('click', async () => {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    await saveCurrentModelPreset(`Outfit Custom (${timeStr})`)
  })

  document.getElementById('btn-quick-save-hair')?.addEventListener('click', async () => {
    const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    await saveCurrentModelPreset(`Hairstyle Custom (${timeStr})`)
  })

  document.getElementById('btn-restore-default-model-tab')?.addEventListener('click', () => {
    restoreDefaultModel()
  })

  // Khởi tạo hiển thị danh sách Model tùy biến từ IndexedDB
  renderCustomModelsList()
}

function resetTweaks() {
  hairParamFront = 0
  hairParamSide = 0
  hairParamBack = 0
  manualCheek = 0
  manualSmile = 0
  manualBrow = 0
  manualMouthOpen = 0
  manualAngleX = 0
  manualAngleY = 0
  manualAngleZ = 0
  lockAngle = false

  const chkLock = document.getElementById('chk-lock-angle') as HTMLInputElement
  if (chkLock) chkLock.checked = false

  ;['slider-hair-front', 'slider-hair-side', 'slider-hair-back', 'slider-cheek', 'slider-smile', 'slider-brow', 'slider-mouth', 'slider-angle-x', 'slider-angle-y', 'slider-angle-z'].forEach((id) => {
    const el = document.getElementById(id) as HTMLInputElement
    if (el) el.value = '0'
  })
  ;['val-hair-front', 'val-hair-side', 'val-hair-back', 'val-cheek', 'val-smile', 'val-brow', 'mouth-val'].forEach((id) => {
    const el = document.getElementById(id)
    if (el) el.textContent = '0.0'
  })
  ;['val-angle-x', 'val-angle-y', 'val-angle-z'].forEach((id) => {
    const el = document.getElementById(id)
    if (el) el.textContent = '0°'
  })
}

// 13. Khởi chạy ứng dụng
initUIEvents()
loadModel(MODEL_PATHS.hiyori)
