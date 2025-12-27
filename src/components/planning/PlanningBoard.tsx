import React from 'react';
import { Whiteboard } from './Whiteboard';

export const PlanningBoard: React.FC = () => {
  return (
    <div className="fixed inset-0 w-full h-full bg-white">
      <Whiteboard className="w-full h-full" />
    </div>
  );
};

PlanningBoard.displayName = 'PlanningBoard';

