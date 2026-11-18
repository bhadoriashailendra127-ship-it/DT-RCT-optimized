import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const VALID_USERNAME = 'admin';
const VALID_PASSWORD = 'admin123';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  function handleSubmit(e) {
    e.preventDefault();
    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      sessionStorage.setItem('hcltech_authenticated', 'true');
      navigate('/landing-page');
    } else {
      setError('Invalid username or password.');
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--header-gradient)',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: '40px 36px',
          width: 360,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>
            HCLTech
          </div>
          <div
            style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}
          >
            Network Digital Twin
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-muted)',
              marginBottom: 4,
            }}
          >
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: '100%', marginBottom: 16, padding: '10px 12px', border: '1px solid #333', borderRadius: '6px' }}
            autoFocus
          />

          <label
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-muted)',
              marginBottom: 4,
            }}
          >
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', marginBottom: 20, padding: '10px 12px', border: '1px solid #333', borderRadius: '6px' }}
          />

          {error && (
            <div style={{ color: '#8F1D28', fontSize: 13, marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn blue"
            style={{ width: '100%', padding: '10px 0' }}
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
