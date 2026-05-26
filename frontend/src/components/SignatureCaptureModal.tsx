import React, { useRef, useState, useCallback, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';

interface Props {
  fieldType: 'signature' | 'initials';
  onConfirm: (base64: string) => void;
  onCancel: () => void;
}

type Tab = 'draw' | 'type';

export function SignatureCaptureModal({ fieldType, onConfirm, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>('draw');
  const [typedText, setTypedText] = useState('');
  const [typePreview, setTypePreview] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const sigPadRef = useRef<SignatureCanvas>(null);

  // Render typed text to offscreen canvas whenever typedText changes
  useEffect(() => {
    if (!typedText.trim()) { setTypePreview(null); return; }
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 400, 120);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 120);
    ctx.fillStyle = '#1a1a2e';
    ctx.font = "600 48px 'Dancing Script', cursive";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedText, 200, 60);
    setTypePreview(canvas.toDataURL('image/png'));
  }, [typedText]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setUploadPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleConfirm = useCallback(() => {
    if (tab === 'draw') {
      if (uploadPreview) {
        onConfirm(uploadPreview);
        return;
      }
      if (!sigPadRef.current || sigPadRef.current.isEmpty()) return;
      onConfirm(sigPadRef.current.toDataURL('image/png'));
    } else {
      if (!typePreview) return;
      onConfirm(typePreview);
    }
  }, [tab, uploadPreview, typePreview, onConfirm]);

  const canConfirm =
    tab === 'draw'
      ? uploadPreview !== null || (sigPadRef.current && !sigPadRef.current.isEmpty())
      : typePreview !== null;

  // Re-evaluate confirm button on every render for draw tab
  const [drawHasSig, setDrawHasSig] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900 text-lg">
            {fieldType === 'initials' ? 'Capture Initials' : 'Capture Signature'}
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === 'draw' ? 'text-brand-700 border-b-2 border-brand-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setTab('draw')}
          >
            Draw or Upload
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === 'type' ? 'text-brand-700 border-b-2 border-brand-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setTab('type')}
          >
            Type it
          </button>
        </div>

        <div className="p-6 space-y-4">
          {tab === 'draw' && (
            <>
              {uploadPreview ? (
                <div className="text-center">
                  <img src={uploadPreview} alt="uploaded signature" className="max-h-28 mx-auto border border-gray-200 rounded-lg p-2" />
                  <button
                    className="text-xs text-red-400 hover:text-red-600 mt-2"
                    onClick={() => setUploadPreview(null)}
                  >
                    Remove uploaded image
                  </button>
                </div>
              ) : (
                <>
                  <div className="border-2 border-gray-300 rounded-xl overflow-hidden bg-white touch-none">
                    <SignatureCanvas
                      ref={sigPadRef}
                      canvasProps={{ width: 468, height: 160, className: 'w-full h-full' }}
                      backgroundColor="white"
                      onEnd={() => setDrawHasSig(true)}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      className="btn-secondary text-sm py-1.5 px-3"
                      onClick={() => { sigPadRef.current?.clear(); setDrawHasSig(false); }}
                    >
                      Clear
                    </button>
                    <span className="text-gray-300 text-sm">or</span>
                    <label className="text-sm text-brand-600 font-medium cursor-pointer hover:text-brand-700">
                      Upload PNG/JPG
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </label>
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'type' && (
            <>
              <input
                type="text"
                className="input text-lg"
                placeholder={fieldType === 'initials' ? 'Your initials (e.g. JD)' : 'Your full name'}
                value={typedText}
                onChange={e => setTypedText(e.target.value)}
                autoFocus
              />
              {typePreview ? (
                <div className="border border-gray-200 rounded-xl overflow-hidden bg-white p-2">
                  <img src={typePreview} alt="signature preview" className="w-full h-24 object-contain" />
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-200 rounded-xl h-24 flex items-center justify-center">
                  <p className="text-gray-400 text-sm">Preview will appear here</p>
                </div>
              )}
              <p className="text-xs text-gray-400">Rendered using Dancing Script font</p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          <button className="btn-secondary flex-1" onClick={onCancel}>Cancel</button>
          <button
            className="btn-primary flex-1"
            onClick={handleConfirm}
            disabled={tab === 'draw' ? (!uploadPreview && !drawHasSig) : !typePreview}
          >
            Use this {fieldType === 'initials' ? 'Initials' : 'Signature'}
          </button>
        </div>
      </div>
    </div>
  );
}
