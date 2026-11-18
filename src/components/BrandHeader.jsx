import { Info, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function BrandHeader({ title = 'Network Digital Twin' }) {
  const navigate = useNavigate();

  function handleSignOut() {
    sessionStorage.removeItem('hcltech_authenticated');
    navigate('/');
  }

  return (
    <header className="flex items-center justify-between px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-700">
      <span className="text-white font-semibold text-2xl">
        HCLTech
      </span>
      <span className="text-white font-semibold text-2xl">{title}</span>
      <div className="flex items-start gap-4 whitespace-nowrap">
        <div className="flex flex-col items-center text-white/80 leading-none">
          <Info className="w-6 h-6" />
          <span className='pt-2'> 1.0.0</span>
        </div>
        <div>
          <button
          type="button"
          onClick={handleSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="text-white/80 hover:text-white bg-transparent border-none cursor-pointer"
          >
            <LogOut className="w-6 h-6" />
          </button>
        </div>
      </div>
    </header>
  );
}
