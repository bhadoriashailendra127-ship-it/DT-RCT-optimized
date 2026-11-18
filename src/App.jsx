import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import CoreApp from './pages/CoreApp';
import TransportApp from './pages/TransportApp';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RANApp from './pages/RANApp';
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        
        <Route path="/" element={<LoginPage />} />
        <Route path="/landing-page" element={<LandingPage />} />
        <Route path="/5g-core" element={<CoreApp />} />
        <Route path="/transport" element={<TransportApp />} />
        <Route path="/ran" element={<RANApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
