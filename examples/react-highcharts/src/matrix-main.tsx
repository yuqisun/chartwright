import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { TypeMatrix } from './components/TypeMatrix.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <TypeMatrix />
  </StrictMode>,
);
