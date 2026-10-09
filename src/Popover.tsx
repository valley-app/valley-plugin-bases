import { React, api } from './runtime'

export interface PopoverState {
  anchor: HTMLElement
  align: 'start' | 'end'
  render: (close: () => void) => React.ReactNode
  className?: string
  guard?: (event: React.SyntheticEvent) => void
}

export function Popover({ state, onClose }: { state: PopoverState; onClose: () => void }) {
  React.useEffect(() => {
    let disposed = false
    let dismiss: (() => void) | undefined
    const options = {
      width: state.className === 'is-wide' ? 520 : 260,
      className: 'base-host-popover',
      ariaLabel: state.anchor.getAttribute('aria-label') ?? undefined,
    }
    void api.ui.openPopover(({ close }) => {
      dismiss = close
      if (disposed) { close(); return null }
      return <div className="base-popover" onInputCapture={state.guard} onChangeCapture={state.guard} onFocusCapture={state.guard} onBlurCapture={state.guard} onPointerDownCapture={state.guard} onKeyDownCapture={state.guard}>{state.render(close)}</div>
    }, { anchor: state.anchor, align: state.align, gap: 4 }, options).finally(() => { if (!disposed) onClose() })
    return () => { disposed = true; dismiss?.() }
  }, [state, onClose])
  return null
}

export function usePopover(guard?: (event: React.SyntheticEvent) => void, changed?: (open: boolean) => void) {
  const [state, setState] = React.useState<PopoverState | null>(null)
  const close = React.useCallback(() => { changed?.(false); setState(null) }, [changed])
  const open = (anchor: HTMLElement, render: PopoverState['render'], options: { align?: 'start' | 'end'; className?: string } = {}): void => {
    const next = state?.anchor === anchor ? null : { anchor, render, align: options.align ?? 'start', className: options.className, guard }
    changed?.(Boolean(next))
    setState(next)
  }
  return { state, open, close, node: state ? <Popover state={state} onClose={close} /> : null }
}
