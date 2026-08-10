import React, { useState, useEffect } from 'react';
import { X, Sparkles, Check } from 'lucide-react';

export default function AIModelWizard({ product, onClose, onSaveResult }) {
  const [step, setStep] = useState(1); // 1: Select Model, 2: Loading, 3: Completed
  const [selectedModel, setSelectedModel] = useState(null);
  const [loadingText, setLoadingText] = useState('Fabric mapping...');

  const models = [
    { 
      id: 'm1', 
      name: 'Aarav', 
      gender: 'Male', 
      avatar: '/assets/model_male.png',
      desc: 'Professional studio lighting, warm skin tone' 
    },
    { 
      id: 'm2', 
      name: 'Ananya', 
      gender: 'Female', 
      avatar: '/assets/model_female.png',
      desc: 'Elegant editorial pose, pastel background matching' 
    }
  ];

  // Cycles through loading messages to simulate backend processing
  useEffect(() => {
    if (step === 2) {
      const messages = [
        { text: 'Extracting product fabric texture...', time: 800 },
        { text: 'Adjusting shadows and folds...', time: 1800 },
        { text: 'Positioning model posture & glare...', time: 2800 },
        { text: 'Blending lighting leaks...', time: 3800 },
        { text: 'Finalizing 8k render output...', time: 4800 }
      ];

      const timers = messages.map(msg => 
        setTimeout(() => setLoadingText(msg.text), msg.time)
      );

      const completionTimer = setTimeout(() => {
        setStep(3);
      }, 5500);

      return () => {
        timers.forEach(clearTimeout);
        clearTimeout(completionTimer);
      };
    }
  }, [step]);

  const handleStartGeneration = () => {
    if (!selectedModel) {
      alert('Please select an AI model first.');
      return;
    }
    setStep(2);
  };

  const handleSave = () => {
    // Select the correct generated image asset based on the chosen model gender
    const finalImage = selectedModel.gender === 'Male' ? '/assets/model_male.png' : '/assets/model_female.png';
    onSaveResult(product.id, finalImage);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} style={{ color: 'var(--c-accent)', fill: 'var(--c-accent)' }} />
            <span className="modal-title">AI Photoshoot Wizard</span>
          </div>
          <div className="modal-close-btn" onClick={onClose}>
            <X size={16} />
          </div>
        </div>

        {/* Step 1: Select AI Model */}
        {step === 1 && (
          <div className="ai-wizard-body">
            <div className="ai-wizard-header-steps">
              <span>Selected product: <strong>{product.title}</strong></span>
              <span>Step 1 of 2</span>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--c-peach-dark)', fontWeight: 600 }}>
              Select an AI model roster item to carry out the wear photoshoot:
            </div>

            <div className="model-selection-grid">
              {models.map(model => (
                <div 
                  key={model.id}
                  className={`model-option-card ${selectedModel?.id === model.id ? 'selected' : ''}`}
                  onClick={() => setSelectedModel(model)}
                >
                  <div className="model-option-avatar">
                    <img src={model.avatar} alt={model.name} />
                  </div>
                  <span className="model-option-name">{model.name}</span>
                  <span className="model-option-desc">{model.gender} • Indian</span>
                </div>
              ))}
            </div>

            {selectedModel && (
              <div 
                style={{ 
                  background: 'rgba(255,255,255,0.4)', 
                  border: '1px solid var(--glass-border)', 
                  borderRadius: '12px', 
                  padding: '10px', 
                  fontSize: '0.72rem' 
                }}
              >
                <strong>Setup details:</strong> {selectedModel.desc}
              </div>
            )}

            <button className="btn-submit-form" onClick={handleStartGeneration}>
              Start AI Photoshoot
            </button>
          </div>
        )}

        {/* Step 2: Processing AI Model */}
        {step === 2 && (
          <div className="ai-loading-container">
            <div className="ai-spinner"></div>
            <span className="ai-loading-text">Generating AI Model Wear...</span>
            <span className="ai-loading-subtext">{loadingText}</span>
          </div>
        )}

        {/* Step 3: Success and Before/After Review */}
        {step === 3 && (
          <div className="ai-wizard-body">
            <div className="compare-success-banner">
              <Check size={16} /> Photoshoot rendered in 8k successfully!
            </div>

            <div className="compare-container">
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--c-peach-darker)' }}>
                Before vs After Comparison:
              </span>
              
              <div className="compare-row">
                <div className="compare-box">
                  <img src={product.image} alt="Original product Flat" />
                  <span className="compare-label">Flat Lay</span>
                </div>
                <div className="compare-box" style={{ border: '2px solid var(--c-accent)' }}>
                  <img 
                    src={selectedModel.gender === 'Male' ? '/assets/model_male.png' : '/assets/model_female.png'} 
                    alt="AI Generated Portrait" 
                  />
                  <span className="compare-label" style={{ background: 'var(--c-accent)' }}>AI Model</span>
                </div>
              </div>
            </div>

            <div className="ai-wizard-actions">
              <button 
                className="btn-ai-wizard secondary" 
                style={{ flex: 1 }}
                onClick={() => setStep(1)}
              >
                Re-generate
              </button>
              <button 
                className="btn-ai-wizard primary" 
                style={{ flex: 1.5 }}
                onClick={handleSave}
              >
                Save to Catalog
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
