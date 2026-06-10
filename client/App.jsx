import React, { useState } from 'react';
import Scanner from './components/Scanner.jsx';
import Chart from './components/Chart.jsx';
import Checklist, { autoFillFromSignal } from './components/Checklist.jsx';

export default function App() {
  const [selectedPair, setSelectedPair] = useState(null);
  const [checklistPair, setChecklistPair] = useState(null);
  const [savedChecklists, setSavedChecklists] = useState({});

  function openChecklist(pair, signal) {
    setChecklistPair({ pair, signal });
    // Auto-save the auto-filled state on first open — gives the scanner card a score immediately.
    setSavedChecklists((prev) => {
      if (prev[pair]) return prev;
      return { ...prev, [pair]: autoFillFromSignal(signal) };
    });
  }

  function saveChecklist(pair, state) {
    setSavedChecklists((prev) => ({ ...prev, [pair]: state }));
  }

  return (
    <div className="app">
      <header className="header">
        <h1>ForexLens</h1>
        <span className="tagline">Weekly Forex Market Scanner</span>
      </header>
      <main className="main">
        <div style={{ display: selectedPair ? 'none' : 'block' }}>
          <Scanner
            onSelectPair={setSelectedPair}
            onOpenChecklist={openChecklist}
            savedChecklists={savedChecklists}
          />
        </div>
        {selectedPair && (
          <Chart
            pair={selectedPair}
            onClose={() => setSelectedPair(null)}
            onOpenChecklist={(signal) => openChecklist(selectedPair, signal)}
            savedChecklist={savedChecklists[selectedPair]}
          />
        )}
      </main>
      {checklistPair && (
        <Checklist
          key={checklistPair.pair}
          pair={checklistPair.pair}
          signal={checklistPair.signal}
          savedState={savedChecklists[checklistPair.pair]}
          onClose={() => setChecklistPair(null)}
          onSave={(state) => saveChecklist(checklistPair.pair, state)}
        />
      )}
      <footer className="footer">
        <span>Not financial advice. Analytical signals only.</span>
      </footer>
    </div>
  );
}
