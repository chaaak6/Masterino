import { createRoot } from 'react-dom/client';

import { OverlayLocale } from './Locale';
import ScreenCaptureOverlay from './ScreenCaptureOverlay';

const root = createRoot(document.getElementById('root')!);
root.render(
  <OverlayLocale>
    <ScreenCaptureOverlay />
  </OverlayLocale>,
);
