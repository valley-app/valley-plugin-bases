import { React } from './runtime'

type Shape = [string, Record<string, string>]

// Lucide glyphs (ISC licence), stored as SVG child elements.
const shapes: Record<string, Shape[]> = {
  'table': [["path",{"d":"M12 3v18"}],["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"M3 9h18"}],["path",{"d":"M3 15h18"}]],
  'layout-grid': [["rect",{"width":"7","height":"7","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"7","x":"14","y":"3","rx":"1"}],["rect",{"width":"7","height":"7","x":"14","y":"14","rx":"1"}],["rect",{"width":"7","height":"7","x":"3","y":"14","rx":"1"}]],
  'list': [["path",{"d":"M3 12h.01"}],["path",{"d":"M3 18h.01"}],["path",{"d":"M3 6h.01"}],["path",{"d":"M8 12h13"}],["path",{"d":"M8 18h13"}],["path",{"d":"M8 6h13"}]],
  'map': [["path",{"d":"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"}],["path",{"d":"M15 5.764v15"}],["path",{"d":"M9 3.236v15"}]],
  'chevrons-up-down': [["path",{"d":"m7 15 5 5 5-5"}],["path",{"d":"m7 9 5-5 5 5"}]],
  'list-filter': [["path",{"d":"M3 6h18"}],["path",{"d":"M7 12h10"}],["path",{"d":"M10 18h4"}]],
  'arrow-up-down': [["path",{"d":"m21 16-4 4-4-4"}],["path",{"d":"M17 20V4"}],["path",{"d":"m3 8 4-4 4 4"}],["path",{"d":"M7 4v16"}]],
  'search': [["circle",{"cx":"11","cy":"11","r":"8"}],["path",{"d":"m21 21-4.3-4.3"}]],
  'plus': [["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],
  'info': [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],
  'text': [["path",{"d":"M17 6.1H3"}],["path",{"d":"M21 12.1H3"}],["path",{"d":"M15.1 18H3"}]],
  'binary': [["rect",{"x":"14","y":"14","width":"4","height":"6","rx":"2"}],["rect",{"x":"6","y":"4","width":"4","height":"6","rx":"2"}],["path",{"d":"M6 20h4"}],["path",{"d":"M14 10h4"}],["path",{"d":"M6 14h2v6"}],["path",{"d":"M14 4h2v6"}]],
  'check-square': [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2"}],["path",{"d":"m9 12 2 2 4-4"}]],
  'calendar': [["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}]],
  'clock': [["circle",{"cx":"12","cy":"12","r":"10"}],["polyline",{"points":"12 6 12 12 16 14"}]],
  'tags': [["path",{"d":"m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"}],["path",{"d":"M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"}],["circle",{"cx":"6.5","cy":"9.5","r":".5","fill":"currentColor"}]],
  'forward': [["polyline",{"points":"15 17 20 12 15 7"}],["path",{"d":"M4 18v-2a4 4 0 0 1 4-4h12"}]],
  'file': [["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}]],
  'folder': [["path",{"d":"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"}]],
  'file-question': [["path",{"d":"M12 17h.01"}],["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"}],["path",{"d":"M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3"}]],
  'square-function': [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}],["path",{"d":"M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3"}],["path",{"d":"M9 11.2h5.7"}]],
  'chevron-right': [["path",{"d":"m9 18 6-6-6-6"}]],
  'chevron-up': [["path",{"d":"m18 15-6-6-6 6"}]],
  'chevron-down': [["path",{"d":"m6 9 6 6 6-6"}]],
  'trash-2': [["path",{"d":"M3 6h18"}],["path",{"d":"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"}],["path",{"d":"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"}],["line",{"x1":"10","x2":"10","y1":"11","y2":"17"}],["line",{"x1":"14","x2":"14","y1":"11","y2":"17"}]],
  'grip-vertical': [["circle",{"cx":"9","cy":"12","r":"1"}],["circle",{"cx":"9","cy":"5","r":"1"}],["circle",{"cx":"9","cy":"19","r":"1"}],["circle",{"cx":"15","cy":"12","r":"1"}],["circle",{"cx":"15","cy":"5","r":"1"}],["circle",{"cx":"15","cy":"19","r":"1"}]],
  'code-xml': [["path",{"d":"m18 16 4-4-4-4"}],["path",{"d":"m6 8-4 4 4 4"}],["path",{"d":"m14.5 4-5 16"}]],
  'rotate-ccw': [["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],
  'copy': [["rect",{"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2"}],["path",{"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"}]],
  'file-down': [["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M12 18v-6"}],["path",{"d":"m9 15 3 3 3-3"}]],
  'eye-off': [["path",{"d":"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"}],["path",{"d":"M14.084 14.158a3 3 0 0 1-4.242-4.242"}],["path",{"d":"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"}],["path",{"d":"m2 2 20 20"}]],
  'eye': [["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],
  'x': [["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],
  'triangle-alert': [["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{"d":"M12 9v4"}],["path",{"d":"M12 17h.01"}]],
  'arrow-down-wide-narrow': [["path",{"d":"m3 16 4 4 4-4"}],["path",{"d":"M7 20V4"}],["path",{"d":"M11 4h10"}],["path",{"d":"M11 8h7"}],["path",{"d":"M11 12h4"}]],
  'arrow-up-narrow-wide': [["path",{"d":"m3 8 4-4 4 4"}],["path",{"d":"M7 4v16"}],["path",{"d":"M11 12h4"}],["path",{"d":"M11 16h7"}],["path",{"d":"M11 20h10"}]],
  'eraser': [["path",{"d":"m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"}],["path",{"d":"M22 21H7"}],["path",{"d":"m5 11 9 9"}]],
  'group': [["path",{"d":"M3 7V5c0-1.1.9-2 2-2h2"}],["path",{"d":"M17 3h2c1.1 0 2 .9 2 2v2"}],["path",{"d":"M21 17v2c0 1.1-.9 2-2 2h-2"}],["path",{"d":"M7 21H5c-1.1 0-2-.9-2-2v-2"}],["rect",{"width":"7","height":"5","x":"7","y":"7","rx":"1"}],["rect",{"width":"7","height":"5","x":"10","y":"12","rx":"1"}]],
  'pencil': [["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}],["path",{"d":"m15 5 4 4"}]],
  'settings': [["path",{"d":"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"}],["circle",{"cx":"12","cy":"12","r":"3"}]],
  'layers-2': [["path",{"d":"m16.02 12 5.48 3.13a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74L7.98 12"}],["path",{"d":"M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74Z"}]],
  'files': [["path",{"d":"M20 7h-3a2 2 0 0 1-2-2V2"}],["path",{"d":"M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"}],["path",{"d":"M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"}]],
  'link': [["path",{"d":"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"}],["path",{"d":"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"}]],
  'image': [["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}],["circle",{"cx":"9","cy":"9","r":"2"}],["path",{"d":"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}]],
  'map-pin': [["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{"cx":"12","cy":"10","r":"3"}]],
  'calendar-range': [["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M16 2v4"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 2v4"}],["path",{"d":"M17 14h-6"}],["path",{"d":"M13 18H7"}],["path",{"d":"M7 14h.01"}],["path",{"d":"M17 18h.01"}]],
  'minus': [["path",{"d":"M5 12h14"}]],
  'locate': [["line",{"x1":"2","x2":"5","y1":"12","y2":"12"}],["line",{"x1":"19","x2":"22","y1":"12","y2":"12"}],["line",{"x1":"12","x2":"12","y1":"2","y2":"5"}],["line",{"x1":"12","x2":"12","y1":"19","y2":"22"}],["circle",{"cx":"12","cy":"12","r":"7"}]],
  'arrow-right': [["path",{"d":"M5 12h14"}],["path",{"d":"m12 5 7 7-7 7"}]],
  'external-link': [["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}],["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}]],
  'square-pen': [["path",{"d":"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}],["path",{"d":"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"}]],
  'sigma': [["path",{"d":"M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"}]],
  'type': [["polyline",{"points":"4 7 4 4 20 4 20 7"}],["line",{"x1":"9","x2":"15","y1":"20","y2":"20"}],["line",{"x1":"12","x2":"12","y1":"4","y2":"20"}]],
  'hash': [["line",{"x1":"4","x2":"20","y1":"9","y2":"9"}],["line",{"x1":"4","x2":"20","y1":"15","y2":"15"}],["line",{"x1":"10","x2":"8","y1":"3","y2":"21"}],["line",{"x1":"16","x2":"14","y1":"3","y2":"21"}]],
  'file-text': [["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],
  'ellipsis': [["circle",{"cx":"12","cy":"12","r":"1"}],["circle",{"cx":"19","cy":"12","r":"1"}],["circle",{"cx":"5","cy":"12","r":"1"}]],
}

export const ICON_NAMES = Object.keys(shapes)

const escapeAttribute = (value: string): string => value.replace(/[&"<>]/g, (ch) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[ch]!)

/** SVG markup for DOM surfaces that are not React (map markers). */
export function iconSvg(name: string, size = 14): string | null {
  const glyph = shapes[name.replace(/^lucide-/, '')]
  if (!glyph) return null
  const children = glyph.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${escapeAttribute(value)}"`).join(' ')}/>`).join('')
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`
}

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const glyph = shapes[name.replace(/^lucide-/, '')] ?? shapes['file-question']
  return (
    <svg
      className={className ? `base-icon ${className}` : 'base-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph.map(([tag, attrs], index) => React.createElement(tag, { key: index, ...attrs }))}
    </svg>
  )
}
