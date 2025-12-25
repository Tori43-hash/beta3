import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PenTool, Eraser, Move, Undo, Palette, Minus, X } from 'lucide-react';
import { DebouncedColorInput } from '../common/DebouncedColorInput';

interface WhiteboardProps {
  className?: string;
}

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  size: number;
  tool: 'pen' | 'eraser';
}

export const Whiteboard: React.FC<WhiteboardProps> = ({ className = "" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const transformRef = useRef({ scale: 1, offset: { x: 0, y: 0 } });
  
  const [undoCount, setUndoCount] = useState(0);
  const [tool, setTool] = useState<'pen' | 'eraser' | 'pan'>('pen');
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(3);
  const [showDebug, setShowDebug] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [tick, setTick] = useState(0);

  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const requestRef = useRef<number | null>(null);
  const isScheduledRef = useRef(false);

  const colors = ['#000000', '#FF0000', '#0000FF', '#00FF00'];

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const { scale, offset } = transformRef.current;

    // Clear and set transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    
    ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);

    const drawStroke = (stroke: Stroke) => {
        if (stroke.points.length < 2) return;
        
        ctx.beginPath();
        ctx.strokeStyle = stroke.tool === 'pen' ? stroke.color : '#FFFFFF';
        ctx.lineWidth = stroke.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        if (stroke.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
        }

        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
    };

    strokesRef.current.forEach(drawStroke);
    if (currentStrokeRef.current) {
        drawStroke(currentStrokeRef.current);
    }
  }, []);

  const scheduleRedraw = useCallback(() => {
    if (!isScheduledRef.current) {
        isScheduledRef.current = true;
        if (requestRef.current !== null) {
            cancelAnimationFrame(requestRef.current);
        }
        requestRef.current = requestAnimationFrame(() => {
            redraw();
            isScheduledRef.current = false;
            requestRef.current = null;
        });
    }
  }, [redraw]);

  const handleUndo = useCallback(() => {
    if (strokesRef.current.length > 0) {
        strokesRef.current.pop();
        setUndoCount(c => c - 1);
        scheduleRedraw();
    }
  }, [scheduleRedraw]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;
        
        const { width, height } = container.getBoundingClientRect();
        // Handle high DPI
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        
        scheduleRedraw();
    };

    window.addEventListener('resize', handleResize);
    // Initial resize
    handleResize();
    
    // Observer for container size changes
    const resizeObserver = new ResizeObserver(handleResize);
    if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
    }

    return () => {
        window.removeEventListener('resize', handleResize);
        resizeObserver.disconnect();
    };
  }, [scheduleRedraw]);

  // Wheel Handler (Zoom & Pan)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const { scale, offset } = transformRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (e.ctrlKey) {
        // Zoom
        const rect = canvas.getBoundingClientRect();
        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        const newScale = Math.min(Math.max(0.1, scale + delta), 10);
        
        // Mouse position relative to canvas
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Canvas coordinate space (DPI corrected)
        const dpr = window.devicePixelRatio || 1;
        const canvasX = x * dpr;
        const canvasY = y * dpr;

        // World coordinate before zoom
        const worldX = (canvasX - offset.x) / scale;
        const worldY = (canvasY - offset.y) / scale;
        
        // New offset to keep world coordinate stationary
        const newOffsetX = canvasX - worldX * newScale;
        const newOffsetY = canvasY - worldY * newScale;
        
        transformRef.current = {
          scale: newScale,
          offset: { x: newOffsetX, y: newOffsetY }
        };
        
        scheduleRedraw();
        setTick(t => t + 1);
      } else {
        // Pan
        const dpr = window.devicePixelRatio || 1;
        const newOffsetX = offset.x - e.deltaX * dpr;
        const newOffsetY = offset.y - e.deltaY * dpr;

        transformRef.current = {
          scale,
          offset: { x: newOffsetX, y: newOffsetY }
        };

        scheduleRedraw();
        setTick(t => t + 1);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
        container.removeEventListener('wheel', handleWheel);
    };
  }, [scheduleRedraw]);

  // Keyboard Handler (Undo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Robust Ctrl+Z check
      const isZ = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z';
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && isZ) {
        e.preventDefault();
        e.stopPropagation();
        handleUndo();
      }
    };

    // Use window with capture to ensure we get the event
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handleUndo]);

  // Mouse / Touch Handlers
  const getPointerPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    const dpr = window.devicePixelRatio || 1;
    return { x: x * dpr, y: y * dpr };
  };

  const toWorldPos = (pos: Point) => {
    const { scale, offset } = transformRef.current;
    return {
        x: (pos.x - offset.x) / scale,
        y: (pos.y - offset.y) / scale
    };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    // Middle mouse or Space+Click or Pan tool -> Pan
    const isMouseEvent = 'button' in e;
    const isMiddleClick = isMouseEvent && (e as React.MouseEvent).button === 1;
    const isSpaceClick = isMouseEvent && (e as React.MouseEvent).shiftKey; 
    
    if (tool === 'pan' || isMiddleClick || isSpaceClick) {
        isPanningRef.current = true;
        const pos = getPointerPos(e);
        lastMousePosRef.current = pos;
        return;
    }

    if (isMouseEvent && (e as React.MouseEvent).button !== 0) return;

    isDrawingRef.current = true;
    const pos = getPointerPos(e);
    const worldPos = toWorldPos(pos);
    
    currentStrokeRef.current = {
        points: [worldPos],
        color,
        size,
        tool: tool === 'eraser' ? 'eraser' : 'pen'
    };
    scheduleRedraw();
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getPointerPos(e);

    if (isPanningRef.current) {
        const dx = pos.x - lastMousePosRef.current.x;
        const dy = pos.y - lastMousePosRef.current.y;
        const { scale, offset } = transformRef.current;
        
        transformRef.current = {
            scale,
            offset: { x: offset.x + dx, y: offset.y + dy }
        };
        lastMousePosRef.current = pos;
        scheduleRedraw();
        setTick(t => t + 1);
        return;
    }

    if (isDrawingRef.current && currentStrokeRef.current) {
        const worldPos = toWorldPos(pos);
        currentStrokeRef.current.points.push(worldPos);
        scheduleRedraw();
    }
  };

  const handleEnd = () => {
    if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
    }

    if (isDrawingRef.current && currentStrokeRef.current) {
        isDrawingRef.current = false;
        if (currentStrokeRef.current.points.length > 0) {
            strokesRef.current.push(currentStrokeRef.current);
            setUndoCount(c => c + 1);
        }
        currentStrokeRef.current = null;
        scheduleRedraw();
    }
  };

  const resetView = () => {
    transformRef.current = { scale: 1, offset: { x: 0, y: 0 } };
    scheduleRedraw();
    setTick(t => t + 1);
  };

  const clearCanvas = () => {
    strokesRef.current = [];
    setUndoCount(0);
    scheduleRedraw();
  };

  return (
    <div ref={containerRef} className={`relative w-full h-full bg-white overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 block touch-none w-full h-full ${tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
      />

      {/* Debug Info */}
      <div className="absolute top-4 right-4 z-20">
        {showDebug ? (
            <div className="bg-black/90 text-white text-xs font-mono rounded-lg p-3 space-y-2 max-w-md">
                <div className="flex justify-between items-center mb-2">
                    <span className="font-bold">Debug</span>
                    <button onClick={() => setShowDebug(false)} className="text-white/70 hover:text-white"><X className="w-3 h-3" /></button>
                </div>
                <div>Objects: {strokesRef.current.length}</div>
                <div>Scale: {transformRef.current.scale.toFixed(2)}x</div>
                <div>Offset: {Math.round(transformRef.current.offset.x)}, {Math.round(transformRef.current.offset.y)}</div>
            </div>
        ) : (
            <button onClick={() => setShowDebug(true)} className="bg-black/90 text-white text-xs font-mono rounded-lg p-2 hover:bg-black/95 transition-all">
                🔍
            </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-2xl shadow-lg p-3 flex items-center gap-2">
        <button onClick={() => setTool('pen')} className={`p-2 rounded-lg transition-all ${tool === 'pen' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="Pen">
            <PenTool className="w-4 h-4" />
        </button>
        <button onClick={() => setTool('eraser')} className={`p-2 rounded-lg transition-all ${tool === 'eraser' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="Eraser">
            <Eraser className="w-4 h-4" />
        </button>
        <button onClick={() => setTool('pan')} className={`p-2 rounded-lg transition-all ${tool === 'pan' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="Pan Tool">
            <Move className="w-4 h-4" />
        </button>
        
        <div className="w-px h-6 bg-slate-300"></div>
        
        <div className="flex items-center gap-2">
            {colors.map(c => (
                <button 
                    key={c}
                    onClick={() => { setColor(c); if (tool === 'pan') setTool('pen'); }}
                    className={`w-6 h-6 rounded-md border-2 ${color === c ? 'border-slate-900 scale-110' : 'border-slate-300 hover:border-slate-500'}`}
                    style={{ backgroundColor: c }}
                />
            ))}
            <div className={`relative flex items-center justify-center w-8 h-8 rounded-md border-2 transition-all ${colors.includes(color) ? 'border-slate-300 hover:border-slate-500 hover:bg-slate-50' : 'border-slate-900 bg-slate-100'}`}>
                <Palette className="w-4 h-4 text-slate-600 pointer-events-none absolute" />
                <div className="opacity-0 w-full h-full overflow-hidden cursor-pointer">
                    <DebouncedColorInput initialColor={color} onActive={() => {}} onColorChange={(c) => { setColor(c); if(tool === 'pan') setTool('pen'); }} />
                </div>
            </div>
        </div>

        <div className="w-px h-6 bg-slate-300"></div>

        <div className="flex items-center gap-2 px-2">
            <span className="text-xs text-slate-600 font-medium min-w-[40px]">{size}px</span>
            <input 
                type="range" 
                min="1" 
                max="20" 
                value={size} 
                onChange={(e) => setSize(Number(e.target.value))} 
                className="w-20 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-800"
            />
        </div>

        <div className="w-px h-6 bg-slate-300"></div>

        <button onClick={resetView} className="px-2 py-1 text-xs font-bold bg-slate-100 rounded hover:bg-slate-200 text-slate-600">100%</button>
        <button onClick={handleUndo} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title="Undo" disabled={undoCount === 0}>
            <Undo className={`w-4 h-4 ${undoCount === 0 ? 'opacity-30' : ''}`} />
        </button>
        <button onClick={clearCanvas} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-rose-100 hover:text-rose-600" title="Clear">
            <Minus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

Whiteboard.displayName = 'Whiteboard';
