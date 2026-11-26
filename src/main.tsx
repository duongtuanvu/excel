import { createRoot } from 'react-dom/client';
import AuthGate from './AuthGate';
import './styles.css';
import './auth.css';
createRoot(document.getElementById('root')!).render(<AuthGate />);
