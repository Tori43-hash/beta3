import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Trader } from '../../types';
import { Whiteboard } from './Whiteboard';

interface TradersProps {
  tradersList: Trader[];
  openProfile: (trader: Trader) => void;
}

interface ProfileProps {
  trader: Trader;
  goBack: () => void;
}

export const Traders: React.FC<TradersProps> = ({ tradersList, openProfile }) => {
  // Unified Transform State (lifted from Whiteboard)
  const [transform, setTransform] = useState({ scale: 1, offset: { x: 0, y: 0 } });

  return (
    <div className="fixed inset-0 z-40 bg-[#111] overflow-hidden select-none w-screen h-screen blur-loading animate-blur-in">
      <Whiteboard 
        className="w-full h-full" 
        transform={transform}
        onTransformChange={setTransform}
      />
    </div>
  );
};

export const Profile: React.FC<ProfileProps> = ({ trader, goBack }) => {
    return (
        <div className="p-10 flex flex-col items-center justify-center min-h-[50vh] text-slate-400">
            <button onClick={goBack} className="flex items-center gap-2 mb-4 hover:text-slate-800"><ArrowLeft className="w-4 h-4" /> Go Back</button>
            <p>Profile View Placeholder</p>
        </div>
    );
};

Traders.displayName = 'Traders';
Profile.displayName = 'Profile';