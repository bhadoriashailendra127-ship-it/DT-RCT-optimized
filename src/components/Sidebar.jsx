import { Upload, Waypoints, Zap, Network } from 'lucide-react';

const TRANSPORT_MENU = [
  { key: 'ingest', label: 'Data Ingestion', Icon: Upload },
  { key: 'graph', label: 'Ontology Graph', Icon: Waypoints },
  { key: 'whatif', label: 'What-If', Icon: Zap },
  { key: 'queries', label: 'Site Intelligence', Icon: Network }
];

export default function Sidebar({ activeTab, onSelect, menu = TRANSPORT_MENU }) {
  return (
    <div className="sidebar">
      <div className="sidebar-label">MENU</div>
      {menu.map(({ key, label, Icon }) => (
        <button
          key={key}
          className={`sidebar-nav-item ${activeTab === key ? 'active' : ''}`}
          onClick={() => onSelect(key)}
        >
          <Icon size={18} className="ic" />
          <span>{label}</span>
        </button>
      ))}
      <div className="sidebar-spacer" />
    </div>
  );
}
