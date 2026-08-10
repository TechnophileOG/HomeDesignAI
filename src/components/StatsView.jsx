import React from 'react';
import { TrendingUp, Image, Coins, Sparkles, Package, FileText, Zap } from 'lucide-react';
import { formatINR } from '../api/client';

/* Parse a display price like "₹2,499" → 2499 (falls back to 0). */
const parseINR = (price) => {
  const n = parseInt(String(price ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export default function StatsView({ products = [], wallet = null, ledger = [], drafts = 0 }) {
  const live = products.filter((p) => p.status === 'live');
  const catalogueValue = live.reduce((a, p) => a + parseINR(p.price), 0);

  const balance = wallet?.balance ?? 0;
  const creditsConsumed = ledger
    .filter((l) => l.type === 'consume')
    .reduce((a, l) => a + Math.abs(l.amount), 0);
  const shootsRun = ledger.filter((l) => l.type === 'consume').length;

  /* Real 7-day credit activity from the ledger (consumes + top-ups + grants). */
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * DAY_MS);
    return {
      key: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      iso: d.toISOString().slice(0, 10),
    };
  });
  const byDay = (iso) => iso?.slice(0, 10);
  const activity = days.map((d) => ({
    key: d.key,
    value: ledger
      .filter((l) => byDay(l.ts) === d.iso)
      .reduce((a, l) => a + Math.abs(l.amount || 0), 0),
  }));
  const maxActivity = Math.max(1, ...activity.map((a) => a.value));

  return (
    <div className="stats-view">
      <div className="section-title" style={{ fontFamily: 'var(--font-geom)' }}>
        Performance Dashboard
      </div>

      {/* Hero Metric Card */}
      <div className="stats-card-main">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span className="stats-hero-label">Catalogue Value</span>
            <div className="stats-hero-value">₹{formatINR(catalogueValue)}</div>
            <div style={{ fontSize: '0.68rem', opacity: 0.7, marginTop: 2 }}>
              {live.length} product{live.length !== 1 ? 's' : ''} live in your catalogue
            </div>
          </div>
          <span className="stats-hero-trend">
            <TrendingUp size={14} /> {live.length} live
          </span>
        </div>

        {/* Real 7-day credit activity */}
        <div className="chart-container">
          <svg viewBox="0 0 350 100" width="100%" height="100%" preserveAspectRatio="none">
            <defs>
              <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.4" />
                <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>

            <line x1="0" y1="20" x2="350" y2="20" stroke="rgba(139, 90, 43, 0.05)" strokeDasharray="3" />
            <line x1="0" y1="50" x2="350" y2="50" stroke="rgba(139, 90, 43, 0.05)" strokeDasharray="3" />
            <line x1="0" y1="80" x2="350" y2="80" stroke="rgba(139, 90, 43, 0.05)" strokeDasharray="3" />

            {/* Credit activity area */}
            <path
              d={activity.map((a, i) => {
                const x = 10 + (i * 55);
                const y = 80 - (a.value / maxActivity) * 65;
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ') + ' L 340 80 L 10 80 Z'}
              className="chart-area"
            />
            <path
              d={activity.map((a, i) => {
                const x = 10 + (i * 55);
                const y = 80 - (a.value / maxActivity) * 65;
                return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
              }).join(' ')}
              fill="none"
              className="chart-line"
            />

            {/* Nodes */}
            {activity.map((a, i) => (
              <g key={a.key}>
                <circle
                  cx={10 + i * 55}
                  cy={80 - (a.value / maxActivity) * 65}
                  r={a.value > 0 ? 3.5 : 2.5}
                  fill={a.value > 0 ? 'var(--c-accent)' : '#fff'}
                  stroke="var(--c-accent)"
                  strokeWidth="2"
                />
                <text x={10 + i * 55} y="95" textAnchor="middle" fontSize="6" fill="var(--c-peach-dark)" fontWeight="600">
                  {a.key}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginTop: '12px', opacity: 0.7 }}>
          <span>Credit activity — last 7 days</span>
          <span style={{ color: 'var(--c-accent)', fontWeight: 700 }}>Credits in/out</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="stats-grid-2x2">
        <div className="stats-mini-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Package size={14} style={{ color: 'var(--c-accent)' }} />
            <span className="stats-mini-label">Live Products</span>
          </div>
          <div className="stats-mini-val">{live.length}</div>
          <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>Active in your catalogue</span>
        </div>

        <div className="stats-mini-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Image size={14} style={{ color: 'var(--c-accent)' }} />
            <span className="stats-mini-label">AI Shoots Run</span>
          </div>
          <div className="stats-mini-val">{shootsRun}</div>
          <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>Model photoshoots generated</span>
        </div>

        <div className="stats-mini-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Coins size={14} style={{ color: 'var(--c-accent)' }} />
            <span className="stats-mini-label">Credit Balance</span>
          </div>
          <div className="stats-mini-val">{formatINR(balance)}</div>
          <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>Available in your wallet</span>
        </div>

        <div className="stats-mini-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Zap size={14} style={{ color: 'var(--c-accent)' }} />
            <span className="stats-mini-label">Credits Consumed</span>
          </div>
          <div className="stats-mini-val">{formatINR(creditsConsumed)}</div>
          <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>Used across AI shoots</span>
        </div>
      </div>

      {drafts > 0 && (
        <div className="stats-mini-card" style={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FileText size={14} style={{ color: 'var(--c-gold)' }} />
            <span className="stats-mini-label">Drafts waiting for credits</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={12} style={{ color: 'var(--c-accent)' }} />
            <span style={{ fontSize: '0.72rem', color: 'var(--c-peach-dark)' }}>
              Recharge to generate their AI apparel shoot
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
