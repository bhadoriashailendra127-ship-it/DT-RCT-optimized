import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Home, LogOut } from 'lucide-react';

export default function Header({ apiUrl, setApiUrl, mode, modeLabel, onConnect, connecting, title, hideConnectUI, homeTo = '/landing-page' }) {
  const [localUrl, setLocalUrl] = useState(apiUrl);
  const navigate = useNavigate();

  function handleConnectClick() {
    setApiUrl(localUrl);
    onConnect(localUrl);
  }

  function handleSignOut() {
    sessionStorage.removeItem('hcltech_authenticated');
    navigate('/');
  }

  return (
    <header className="app-header flex justify-between items-center">
      <div className="text-2xl font-semibold flex items-center gap-2">
      <button
        className="header-nav-btn"
        onClick={() => navigate(-1)}
        title="Back"
        aria-label="Back"
      >
        <ArrowLeft size={18} />
      </button>
      HCLTech
      </div>
      
      <div className="text-xl font-semibold">{title || <>Vodafone SC&amp;T MVP &middot; Digital Twin Console &middot; Spanner Graph</>}</div>
      <div className="header-right">
        {!hideConnectUI && (
          <div className="conn">
            <input
              type="text"
              value={localUrl}
              onChange={e => setLocalUrl(e.target.value)}
              title="Backend proxy URL (app.py running against your GCP Spanner project)"
              placeholder="http://localhost:8080"
            />
            <button onClick={handleConnectClick} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        )}
        <span className={`pill ${mode === 'live' ? 'live' : 'demo'}`}>
          {mode === 'live' ? '● ' : ''}{modeLabel}
        </span>
        <button
          className="header-nav-btn"
          onClick={() => navigate(homeTo)}
          title="Home"
          aria-label="Home"
        >
          <Home size={18} />
        </button>
        <button
          className="header-nav-btn"
          onClick={handleSignOut}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
