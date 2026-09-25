// Загрузка YouTube IFrame API и минимальные типы.

export type YTPlayer = {
  destroy(): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  getPlaybackRate(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  playVideo(): void
}

type YTEvent<T = unknown> = { target: YTPlayer; data: T }

export type YTNamespace = {
  Player: new (
    element: HTMLIFrameElement | string,
    options: {
      events?: {
        onReady?: (e: YTEvent) => void
        onStateChange?: (e: YTEvent<number>) => void
        onPlaybackRateChange?: (e: YTEvent<number>) => void
        onError?: (e: YTEvent<number>) => void
      }
    }
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT!)
    }
    const script = document.createElement("script")
    script.src = "https://www.youtube.com/iframe_api"
    document.body.appendChild(script)
  })
  return apiPromise
}

export function embedUrl(videoId: string) {
  const origin = encodeURIComponent(window.location.origin)
  return `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0&enablejsapi=1&origin=${origin}`
}
