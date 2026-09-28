export const OVERLAY_SHORTCUTS = {
  close: 'Esc',
  newline: 'Shift + Enter',
  send: 'Enter',
} as const;

export const OVERLAY_LAYOUT = {
  clickToDragThreshold: 5,
  connectorSize: 8,
  dockGap: 12,
  labelClipLength: 60,
  minDragSize: 10,
  panelBottomGap: 32,
  panelHeightEstimate: 208,
  panelHeightEstimateExpanded: 300,
  panelWidthDocked: 440,
  panelWidthInitial: 560,
  viewportMargin: 16,
  windowTagHorizontalInset: 12,
  windowTagMaxWidth: 420,
  windowTagTopOffset: 12,
} as const;
