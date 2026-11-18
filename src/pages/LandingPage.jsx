import { RadioTower, Cpu, Antenna } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BrandHeader from '../components/BrandHeader';
import bgLandingPage from '../assets/bg_landing_Page.png';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div
      className="bg-cover bg-center bg-no-repeat min-h-screen"
      style={{ backgroundImage: `url(${bgLandingPage})` }}
    >
      <BrandHeader />
      <main className="container mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-4xl mb-4 font-semibold text-white"></h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <button
            type="button"
            onClick={() => navigate('/transport')}
            className="group bg-gradient-to-br from-purple-50 to-purple-100 hover:from-purple-100 hover:to-purple-200 rounded-2xl p-8 shadow-md hover:shadow-xl transition-all duration-300 border border-purple-200"
          >
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="bg-purple-500 text-white p-4 rounded-full group-hover:scale-110 transition-transform">
                <RadioTower className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800">Transport</h3>
              <p className="text-gray-600 text-sm">
                A Network Digital Twin in transport bridges the physical and
                virtual worlds
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/5g-core')}
            className="group bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 rounded-2xl p-8 shadow-md hover:shadow-xl transition-all duration-300 border border-blue-200"
          >
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="bg-blue-500 text-white p-4 rounded-full group-hover:scale-110 transition-transform">
                <Cpu className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800">Core</h3>
              <p className="text-gray-600 text-sm">
                Real-time network monitoring and Continuous optimization
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/ran')}
            className="group bg-gradient-to-br from-emerald-50 to-teal-100 hover:from-emerald-100 hover:to-teal-200 rounded-2xl p-8 shadow-md hover:shadow-xl transition-all duration-300 border border-emerald-200"
          >
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="bg-emerald-600 text-white p-4 rounded-full group-hover:scale-110 transition-transform">
                <Antenna className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800">RAN</h3>
              <p className="text-gray-600 text-sm">
                Radio Access Network topology, live telemetry and what-if scenarios
              </p>
            </div>
          </button>
        </div>
      </main>
    </div>
  );
}
