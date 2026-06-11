import React, { useState } from 'react';
import Scanner from './components/Scanner.jsx';
import ChartPanel from './components/ChartPanel.jsx';
import SignalCard from './components/SignalCard.jsx';
import NewsFeed from './components/NewsFeed.jsx';
import Checklist, { autoFillFromSignal } from './components/Checklist.jsx';

export default function App() {
  const [chartPair, setChartPair] = useState(null); // { pair, signal }
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

  function openChart(pair, signal) {
    setChartPair({ pair, signal });
  }

  const base = chartPair ? chartPair.pair.slice(0, 3) : null;
  const quote = chartPair ? chartPair.pair.slice(3) : null;

  return (
    <div className="app">
      <header className="header">
        <h1>ForexLens</h1>
        <span className="tagline">Weekly Forex Market Scanner</span>
      </header>
      <main className="main">
        <div style={{ display: chartPair ? 'none' : 'block' }}>
          <Scanner
            onOpenChart={openChart}
            onOpenChecklist={openChecklist}
            savedChecklists={savedChecklists}
          />
        </div>
        {chartPair && (
          <div className="chart-split">
            <div className="chart-split-left">
              <SignalCard
                signal={chartPair.signal}
                savedChecklist={savedChecklists[chartPair.pair]}
                onOpenChecklist={() => openChecklist(chartPair.pair, chartPair.signal)}
              />
              <div className="news-column">
                <h3>{base} News</h3>
                <NewsFeed currency={base} />
              </div>
              <div className="news-column">
                <h3>{quote} News</h3>
                <NewsFeed currency={quote} />
              </div>
            </div>
            <ChartPanel
              pair={chartPair.pair}
              signal={chartPair.signal}
              savedChecklist={savedChecklists[chartPair.pair]}
              onClose={() => setChartPair(null)}
            />
          </div>
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
