import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
// --- Aurora foundation: self-hosted web fonts (no runtime CDN) ---
// Inter = base UI/body font; Space Grotesk (variable) = display headings;
// JetBrains Mono = true monospace bits. Imported BEFORE the stylesheets so
// the @font-face rules exist when design-system.css sets the font stacks.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource-variable/space-grotesk/index.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { AuthProvider } from './auth/AuthContext';
import { router } from './router';
import './styles/design-system.css';
import './styles/app.css';
import './styles/motion.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
