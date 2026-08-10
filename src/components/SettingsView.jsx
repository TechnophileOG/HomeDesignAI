import React, { useState } from 'react';
import { User, Shield, ShieldCheck, HelpCircle, Globe, Cpu, RefreshCw, Sparkles, LogOut, MailCheck } from 'lucide-react';
import { WalletCard } from './CreditsWallet';

export default function SettingsView({
  profile,
  wallet,
  lightweightMode,
  setLightweightMode,
  onOpenTopUp,
  onOpenTransactions,
  onOpenAdmin,
  isAdmin,
  onSignOut,
  email,
  emailVerified,
  onResendVerification,
}) {
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [isSyncing, setIsSyncing] = useState(false);

  const storeName = profile?.storeName || 'My Store';
  const city      = profile?.city      || 'Delhi';

  const triggerSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      alert('Your catalogue is stored securely in the cloud and stays in sync automatically.');
    }, 1500);
  };

  return (
    <div className="settings-view">
      <div className="section-title" style={{ fontFamily: 'var(--font-geom)' }}>
        Store Settings
      </div>

      {/* Profile Card */}
      <div className="settings-section-card" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'var(--c-peach)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--c-peach-darker)',
            flexShrink: 0,
          }}
        >
          <User size={24} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {storeName}
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>
            B2B Vendor Tier • {city}, India
          </div>
        </div>
        <span className={`plan-chip ${wallet?.plan === 'PRO' ? 'pro' : 'free'}`}>
          <Sparkles size={11} /> {wallet?.plan || 'FREE'}
        </span>
      </div>

      {/* Credits & Wallet */}
      <WalletCard wallet={wallet} onOpenTopUp={onOpenTopUp} onOpenTransactions={onOpenTransactions} />

      {/* Language / Localization */}
      <div className="settings-section-card">
        <div className="settings-section-title">Localization</div>
        <div className="settings-item">
          <div>
            <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Globe size={14} /> Shop Language
            </div>
            <div className="settings-item-sub">Select Hindi, English or regional languages</div>
          </div>
          <div className="settings-item-control">
            <select
              className="settings-select"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
            >
              <option value="English">English</option>
              <option value="Hindi">हिंदी (Hindi)</option>
              <option value="Hinglish">Hinglish</option>
              <option value="Tamil">தமிழ் (Tamil)</option>
              <option value="Bengali">বাংলা (Bengali)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Optimization Mode */}
      <div className="settings-section-card">
        <div className="settings-section-title">Device Optimizer</div>

        <div className="settings-item">
          <div>
            <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Cpu size={14} /> Lightweight Mode
            </div>
            <div className="settings-item-sub">Reduces glass blur effects to run faster on budget phones</div>
          </div>
          <div className="settings-item-control">
            <div
              className={`settings-toggle ${lightweightMode ? 'active' : ''}`}
              onClick={() => setLightweightMode(!lightweightMode)}
            />
          </div>
        </div>
      </div>

      {/* Mobile App Sync */}
      <div className="settings-section-card">
        <div className="settings-section-title">Mobile App Sync</div>

        <div className="settings-item">
          <div>
            <div className="settings-item-label">Cloud Sync</div>
            <div className="settings-item-sub">Your catalogue & credits live in the cloud — always in sync</div>
          </div>
          <div className="settings-item-control">
            <button
              className="btn-ai-wizard primary"
              style={{ padding: '6px 12px', fontSize: '0.72rem', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}
              onClick={triggerSync}
              disabled={isSyncing}
            >
              <RefreshCw size={12} className={isSyncing ? 'ai-spinner' : ''} style={isSyncing ? { width: '12px', height: '12px', animation: 'spin 1s infinite linear' } : {}} />
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Account — Admin Console is visible only to authorized admins */}
      <div className="settings-section-card">
        <div className="settings-section-title">Account</div>

        {isAdmin && (
          <div className="settings-item" onClick={onOpenAdmin} style={{ cursor: 'pointer' }}>
            <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={14} /> Admin Console
            </div>
            <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>Gift credits, manage stores →</div>
          </div>
        )}

        <div className="settings-item">
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MailCheck size={14} /> Email Verification
          </div>
          {emailVerified ? (
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--c-accent-dark)' }}>✓ Verified</div>
          ) : (
            <button
              className="btn-ai-wizard primary"
              style={{ padding: '5px 10px', fontSize: '0.7rem', borderRadius: '9px' }}
              onClick={onResendVerification}
            >
              Resend link to {email}
            </button>
          )}
        </div>

        <div
          className="settings-item"
          onClick={() => {
            if (window.confirm('Sign out of your store account?')) onSignOut();
          }}
          style={{ cursor: 'pointer' }}
        >
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#c0392b' }}>
            <LogOut size={14} /> Sign Out
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>End this session →</div>
        </div>
      </div>

      {/* Support / Help */}
      <div className="settings-section-card">
        <div className="settings-section-title">Help & Legal</div>

        <div className="settings-item" onClick={() => alert("Redirecting to help center...")} style={{ cursor: 'pointer' }}>
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <HelpCircle size={14} /> Support & Guide
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>→</div>
        </div>

        <div className="settings-item" onClick={() => alert("Your account is protected by Firebase Authentication. Your catalogue and credits are stored securely in the cloud — only your account can access them.")} style={{ cursor: 'pointer' }}>
          <div className="settings-item-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Shield size={14} /> Privacy & Data
          </div>
          <div style={{ fontSize: '0.72rem', opacity: 0.5 }}>→</div>
        </div>
      </div>
    </div>
  );
}
