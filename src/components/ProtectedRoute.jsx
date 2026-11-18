import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ children }) {
  const isAuthenticated = sessionStorage.getItem('hcltech_authenticated') === 'true';
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return children;
}
