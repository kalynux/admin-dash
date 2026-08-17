import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Resolve the viewport synchronously on the FIRST render (not after mount).
// Deferring it made every page render its desktop tree for one frame and then
// swap to the mobile tree once the effect ran — a visible flash where content
// showed up, blinked out, then reappeared. This is a client-only SPA, so
// `window` is always available; there's no SSR reason to defer.
function getIsMobile(): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(getIsMobile)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(getIsMobile())
    mql.addEventListener("change", onChange)
    // No re-sync on mount: the initial state is already read synchronously on
    // the first render, so setting it again here only costs a second render.
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}

// Tablet range: wide enough for the desktop shell, too narrow for a comfortable
// 256px sidebar. The dashboard auto-collapses the sidebar to its icon rail here.
const TABLET_QUERY = `(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: 1023px)`

function getIsTablet(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia(TABLET_QUERY).matches
}

export function useIsTablet() {
  const [isTablet, setIsTablet] = React.useState<boolean>(getIsTablet)

  React.useEffect(() => {
    const mql = window.matchMedia(TABLET_QUERY)
    const onChange = () => setIsTablet(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isTablet
}
