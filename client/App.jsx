import React, { useState } from 'react';
import Scanner from './components/Scanner.jsx';
import Chart from './components/Chart.jsx';

export default function App() {
  const [selectedPair, setSelectedPair] = useState(null);

  return (
    <div className="app">
      <header className="header">
        <h1>ForexLens</h1>
        <span className="tagline">Weekly Forex Market Scanner</span>
      </header>
      <main className="main">
        <div style={{ display: selectedPair ? 'none' : 'block' }}>
          <Scanner onSelectPair={setSelectedPair} />
        </div>
        {selectedPair && (
          <Chart pair={selectedPair} onClose={() => setSelectedPair(null)} />
        )}
      </main>
      <footer className="footer">
        <span>Not financial advice. Analytical signals only.</span>
      </footer>
    </div>
  );
}
