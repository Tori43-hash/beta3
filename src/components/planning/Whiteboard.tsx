import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PenTool, Eraser, Move, Undo, Redo, Palette, Minus, Settings, X, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { createPortal } from 'react-dom';
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

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

interface Shortcuts {
  undo: ShortcutConfig;
  redo: ShortcutConfig;
  pen: ShortcutConfig;
  eraser: ShortcutConfig;
  pan: ShortcutConfig;
  clear: ShortcutConfig;
  hideUI: ShortcutConfig;
}

const DEFAULT_SHORTCUTS: Shortcuts = {
  undo: { key: 'z', ctrl: true },
  redo: { key: 'y', ctrl: true },
  pen: { key: 'p' },
  eraser: { key: 'e' },
  pan: { key: 'h' },
  clear: { key: 'c', ctrl: true },
  hideUI: { key: 'h', ctrl: true }
};

export const Whiteboard: React.FC<WhiteboardProps> = ({ className = "" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const transformRef = useRef({ scale: 1, offset: { x: 0, y: 0 } });
  const historyRef = useRef<Stroke[][]>([]);
  const redoHistoryRef = useRef<Stroke[][]>([]);
  
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [tool, setTool] = useState<'pen' | 'eraser' | 'pan'>('pen');
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(3);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState<Shortcuts>(() => {
    const saved = localStorage.getItem('whiteboard-shortcuts');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge with defaults to ensure all keys exist (for backward compatibility)
      return { ...DEFAULT_SHORTCUTS, ...parsed };
    }
    return DEFAULT_SHORTCUTS;
  });
  const [showCoordinates, setShowCoordinates] = useState<boolean>(() => {
    const saved = localStorage.getItem('whiteboard-show-coordinates');
    return saved ? JSON.parse(saved) : false;
  });
  const [showZoom, setShowZoom] = useState<boolean>(() => {
    const saved = localStorage.getItem('whiteboard-show-zoom');
    return saved ? JSON.parse(saved) : false;
  });
  const [zoomSpeed, setZoomSpeed] = useState<number>(() => {
    const saved = localStorage.getItem('whiteboard-zoom-speed');
    return saved ? parseFloat(saved) : 0.001;
  });
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(1);
  const [displayPosition, setDisplayPosition] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>(() => {
    const saved = localStorage.getItem('whiteboard-display-position');
    return (saved as any) || 'bottom-right';
  });
  const [displaySize, setDisplaySize] = useState<'small' | 'medium' | 'large'>(() => {
    const saved = localStorage.getItem('whiteboard-display-size');
    return (saved as any) || 'medium';
  });
  const [backgroundType, setBackgroundType] = useState<'solid' | 'grid' | 'dots'>(() => {
    const saved = localStorage.getItem('whiteboard-background-type');
    return (saved as 'solid' | 'grid' | 'dots') || 'solid';
  });
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [isUIHidden, setIsUIHidden] = useState<boolean>(() => {
    const saved = localStorage.getItem('whiteboard-ui-hidden');
    return saved ? JSON.parse(saved) : false;
  });

  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const isSelectingRef = useRef(false);
  const selectionStartRef = useRef<Point | null>(null);
  const selectionEndRef = useRef<Point | null>(null);
  const selectedStrokesRef = useRef<Set<number>>(new Set());
  const selectionBoundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const isResizingRef = useRef(false);
  const resizeHandleRef = useRef<number | null>(null); // 0: top-left, 1: top-right, 2: bottom-right, 3: bottom-left
  const resizeStartBoundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const resizeStartMouseRef = useRef<Point | null>(null);
  const hoveredHandleRef = useRef<number | null>(null);
  const originalStrokesForResizeRef = useRef<Map<number, Stroke>>(new Map());
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const requestRef = useRef<number | null>(null);
  const isScheduledRef = useRef(false);

  const colors = ['#000000', '#FF0000', '#0000FF'];

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get actual canvas dimensions (in device pixels)
    // Recalculate to handle browser zoom correctly
    const dpr = window.devicePixelRatio || 1;
    const containerRect = container.getBoundingClientRect();
    const actualCanvasWidth = containerRect.width * dpr;
    const actualCanvasHeight = containerRect.height * dpr;
    
    // Ensure canvas dimensions match actual size
    if (canvas.width !== actualCanvasWidth || canvas.height !== actualCanvasHeight) {
      canvas.width = actualCanvasWidth;
      canvas.height = actualCanvasHeight;
      canvas.style.width = `${containerRect.width}px`;
      canvas.style.height = `${containerRect.height}px`;
    }
    
    const { scale, offset } = transformRef.current;

    // Clear and set transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, actualCanvasWidth, actualCanvasHeight);
    
    // Apply transform for drawing
    ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);
    
    // Draw background based on type
    if (backgroundType === 'grid' || backgroundType === 'dots') {
      const gridSize = 20; // Grid size in world coordinates
      
      // Calculate visible world bounds
      // Convert canvas device pixels to world coordinates
      // offset.x and offset.y are in device pixels
      const worldLeft = (-offset.x) / scale;
      const worldTop = (-offset.y) / scale;
      const worldRight = (actualCanvasWidth - offset.x) / scale;
      const worldBottom = (actualCanvasHeight - offset.y) / scale;
      
      // Add margin to ensure background covers entire visible area
      const margin = gridSize * 2;
      const gridLeft = Math.floor((worldLeft - margin) / gridSize) * gridSize;
      const gridTop = Math.floor((worldTop - margin) / gridSize) * gridSize;
      const gridRight = Math.ceil((worldRight + margin) / gridSize) * gridSize;
      const gridBottom = Math.ceil((worldBottom + margin) / gridSize) * gridSize;
      
      if (backgroundType === 'grid') {
        // Draw grid lines
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = Math.max(0.5, 1 / scale); // Adjust line width based on scale, minimum 0.5
        
        // Draw vertical lines
        for (let x = gridLeft; x <= gridRight; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, gridTop);
          ctx.lineTo(x, gridBottom);
          ctx.stroke();
        }
        
        // Draw horizontal lines
        for (let y = gridTop; y <= gridBottom; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(gridLeft, y);
          ctx.lineTo(gridRight, y);
          ctx.stroke();
        }
      } else if (backgroundType === 'dots') {
        // Draw dot grid
        ctx.fillStyle = '#cbd5e1';
        const dotRadius = Math.max(0.5, 1 / scale); // Adjust dot size based on scale
        
        // Draw dots at grid intersections
        for (let x = gridLeft; x <= gridRight; x += gridSize) {
          for (let y = gridTop; y <= gridBottom; y += gridSize) {
            ctx.beginPath();
            ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    const drawStroke = (stroke: Stroke, isSelected: boolean = false) => {
        if (stroke.points.length === 0) return;
        
        if (stroke.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
        }

        // If only one point, draw a circle (dot)
        if (stroke.points.length === 1) {
            const point = stroke.points[0];
            const radius = stroke.size / 2;
            
            // Draw selection highlight if selected
            if (isSelected) {
                ctx.beginPath();
                ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
                ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.beginPath();
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2;
                ctx.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            ctx.beginPath();
            ctx.fillStyle = stroke.tool === 'pen' ? stroke.color : '#FFFFFF';
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Draw selection highlight if selected
            if (isSelected) {
                ctx.beginPath();
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = stroke.size + 6;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.globalAlpha = 0.3;
                
                ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                for (let i = 1; i < stroke.points.length; i++) {
                    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
                }
                ctx.stroke();
                ctx.globalAlpha = 1.0;
                
                ctx.beginPath();
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                
                ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                for (let i = 1; i < stroke.points.length; i++) {
                    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
                }
                ctx.stroke();
            }
            
            // Draw line for multiple points
            ctx.beginPath();
            ctx.strokeStyle = stroke.tool === 'pen' ? stroke.color : '#FFFFFF';
            ctx.lineWidth = stroke.size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
        }
        
        ctx.globalCompositeOperation = 'source-over';
    };

    strokesRef.current.forEach((stroke) => {
        drawStroke(stroke);
    });
    if (currentStrokeRef.current) {
        drawStroke(currentStrokeRef.current);
    }

    // Draw selection rectangle if selecting
    if (isSelectingRef.current && selectionStartRef.current && selectionEndRef.current) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const { scale, offset } = transformRef.current;
        const start = selectionStartRef.current;
        const end = selectionEndRef.current;
        
        // Convert world coordinates to canvas coordinates
        const startCanvasX = start.x * scale + offset.x;
        const startCanvasY = start.y * scale + offset.y;
        const endCanvasX = end.x * scale + offset.x;
        const endCanvasY = end.y * scale + offset.y;
        
        const rectX = Math.min(startCanvasX, endCanvasX);
        const rectY = Math.min(startCanvasY, endCanvasY);
        const rectWidth = Math.abs(endCanvasX - startCanvasX);
        const rectHeight = Math.abs(endCanvasY - startCanvasY);
        
        // Draw selection rectangle
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);
        
        // Draw semi-transparent fill
        ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        ctx.fillRect(rectX, rectY, rectWidth, rectHeight);
        
        ctx.setLineDash([]);
    }

    // Draw bounding box around selected strokes
    if (selectionBoundsRef.current && selectedStrokesRef.current.size > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const { scale, offset } = transformRef.current;
        const { minX, minY, maxX, maxY } = selectionBoundsRef.current;
        
        // Convert world coordinates to canvas coordinates
        const boundsMinX = minX * scale + offset.x;
        const boundsMinY = minY * scale + offset.y;
        const boundsMaxX = maxX * scale + offset.x;
        const boundsMaxY = maxY * scale + offset.y;
        
        const rectX = boundsMinX;
        const rectY = boundsMinY;
        const rectWidth = boundsMaxX - boundsMinX;
        const rectHeight = boundsMaxY - boundsMinY;
        
        // Draw bounding box rectangle (only borders, no fill)
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);
        
        // Draw handles (markers) on corners only for resizing
        const handleSize = 8;
        const halfHandle = handleSize / 2;
        
        // Corner handles only
        const corners = [
            { x: rectX, y: rectY }, // top-left
            { x: rectX + rectWidth, y: rectY }, // top-right
            { x: rectX + rectWidth, y: rectY + rectHeight }, // bottom-right
            { x: rectX, y: rectY + rectHeight } // bottom-left
        ];
        
        // Draw corner handles
        corners.forEach((point) => {
            // White square with blue border
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(point.x - halfHandle, point.y - halfHandle, handleSize, handleSize);
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(point.x - halfHandle, point.y - halfHandle, handleSize, handleSize);
        });
    }
  }, [backgroundType]);

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

  const saveToHistory = useCallback(() => {
    // Save current state to history before making changes (deep copy)
    const deepCopy = strokesRef.current.map(stroke => ({
      ...stroke,
      points: stroke.points.map(p => ({ ...p }))
    }));
    historyRef.current.push(deepCopy);
    // Keep history size reasonable (limit to last 50 states)
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
    }
    // Clear redo history when making a new change
    redoHistoryRef.current = [];
    setRedoCount(0);
  }, []);

  const handleUndo = useCallback(() => {
    if (historyRef.current.length > 0) {
        // Save current state to redo history before undoing
        const currentState = strokesRef.current.map(stroke => ({
          ...stroke,
          points: stroke.points.map(p => ({ ...p }))
        }));
        redoHistoryRef.current.push(currentState);
        if (redoHistoryRef.current.length > 50) {
          redoHistoryRef.current.shift();
        }
        setRedoCount(redoHistoryRef.current.length);
        
        // Restore previous state from history
        const previousState = historyRef.current.pop();
        if (previousState) {
            strokesRef.current = previousState;
            setUndoCount(historyRef.current.length);
            
            // Recalculate selection bounds if there are selected strokes
            if (selectedStrokesRef.current.size > 0) {
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -Infinity;
              let maxY = -Infinity;
              
              selectedStrokesRef.current.forEach((index) => {
                const stroke = strokesRef.current[index];
                if (!stroke || stroke.points.length === 0) return;
                
                const halfSize = stroke.size / 2;
                
                stroke.points.forEach((point) => {
                  minX = Math.min(minX, point.x - halfSize);
                  minY = Math.min(minY, point.y - halfSize);
                  maxX = Math.max(maxX, point.x + halfSize);
                  maxY = Math.max(maxY, point.y + halfSize);
                });
              });
              
              if (minX !== Infinity) {
                selectionBoundsRef.current = { minX, minY, maxX, maxY };
              } else {
                selectionBoundsRef.current = null;
              }
            }
            
            scheduleRedraw();
        }
    }
  }, [scheduleRedraw]);

  const handleRedo = useCallback(() => {
    if (redoHistoryRef.current.length > 0) {
        // Save current state to undo history before redoing
        const currentState = strokesRef.current.map(stroke => ({
          ...stroke,
          points: stroke.points.map(p => ({ ...p }))
        }));
        historyRef.current.push(currentState);
        if (historyRef.current.length > 50) {
          historyRef.current.shift();
        }
        setUndoCount(historyRef.current.length);
        
        // Restore next state from redo history
        const nextState = redoHistoryRef.current.pop();
        if (nextState) {
            strokesRef.current = nextState;
            setRedoCount(redoHistoryRef.current.length);
            
            // Recalculate selection bounds if there are selected strokes
            if (selectedStrokesRef.current.size > 0) {
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -Infinity;
              let maxY = -Infinity;
              
              selectedStrokesRef.current.forEach((index) => {
                const stroke = strokesRef.current[index];
                if (!stroke || stroke.points.length === 0) return;
                
                const halfSize = stroke.size / 2;
                
                stroke.points.forEach((point) => {
                  minX = Math.min(minX, point.x - halfSize);
                  minY = Math.min(minY, point.y - halfSize);
                  maxX = Math.max(maxX, point.x + halfSize);
                  maxY = Math.max(maxY, point.y + halfSize);
                });
              });
              
              if (minX !== Infinity) {
                selectionBoundsRef.current = { minX, minY, maxX, maxY };
              } else {
                selectionBoundsRef.current = null;
              }
            }
            
            scheduleRedraw();
        }
    }
  }, [scheduleRedraw]);

  const clearCanvas = useCallback(() => {
    // Save current state to history before clearing
    saveToHistory();
    strokesRef.current = [];
    setUndoCount(historyRef.current.length);
    scheduleRedraw();
  }, [scheduleRedraw, saveToHistory]);

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
        const delta = -e.deltaY * zoomSpeed;
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
        
        if (showZoom) {
          setCurrentZoom(newScale);
        }
        
        scheduleRedraw();
      } else {
        // Pan
        const dpr = window.devicePixelRatio || 1;
        const newOffsetX = offset.x - e.deltaX * dpr;
        const newOffsetY = offset.y - e.deltaY * dpr;

        transformRef.current = {
            scale,
            offset: { x: newOffsetX, y: newOffsetY }
        };

        if (showZoom) {
          setCurrentZoom(scale);
        }

        scheduleRedraw();
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
        container.removeEventListener('wheel', handleWheel);
    };
  }, [scheduleRedraw, zoomSpeed, showZoom]);

  // Save shortcuts to localStorage
  useEffect(() => {
    localStorage.setItem('whiteboard-shortcuts', JSON.stringify(shortcuts));
  }, [shortcuts]);

  // Save display settings to localStorage
  useEffect(() => {
    localStorage.setItem('whiteboard-show-coordinates', JSON.stringify(showCoordinates));
  }, [showCoordinates]);

  useEffect(() => {
    localStorage.setItem('whiteboard-show-zoom', JSON.stringify(showZoom));
  }, [showZoom]);

  useEffect(() => {
    localStorage.setItem('whiteboard-zoom-speed', zoomSpeed.toString());
  }, [zoomSpeed]);

  useEffect(() => {
    localStorage.setItem('whiteboard-display-position', displayPosition);
  }, [displayPosition]);

  useEffect(() => {
    localStorage.setItem('whiteboard-display-size', displaySize);
  }, [displaySize]);

  useEffect(() => {
    localStorage.setItem('whiteboard-background-type', backgroundType);
  }, [backgroundType]);

  // Save UI hidden state to localStorage
  useEffect(() => {
    localStorage.setItem('whiteboard-ui-hidden', JSON.stringify(isUIHidden));
    // Dispatch custom event for same-tab synchronization
    window.dispatchEvent(new CustomEvent('ui-hidden-changed', { detail: { isUIHidden } }));
  }, [isUIHidden]);

  // Sync currentZoom with transformRef when showZoom is enabled
  useEffect(() => {
    if (showZoom) {
      setCurrentZoom(transformRef.current.scale);
    }
  }, [showZoom]);

  // Clear selection when switching from pan to pen or eraser
  useEffect(() => {
    if (tool !== 'pan' && selectedStrokesRef.current.size > 0) {
      selectedStrokesRef.current.clear();
      selectionBoundsRef.current = null;
      scheduleRedraw();
    }
    
    // Update cursor when tool changes
    const canvas = canvasRef.current;
    if (canvas) {
      if (tool === 'pan') {
        canvas.style.cursor = 'grab';
      } else {
        canvas.style.cursor = 'crosshair';
      }
    }
  }, [tool, scheduleRedraw]);

  // Handle shortcut key capture state
  const [capturingShortcut, setCapturingShortcut] = useState<keyof Shortcuts | null>(null);
  const captureInputRef = useRef<HTMLDivElement>(null);

  // Convert keyboard code to English letter (works regardless of keyboard layout)
  const getEnglishKeyFromCode = (code: string): string => {
    // Handle letter keys (KeyA, KeyB, etc.)
    if (code.startsWith('Key')) {
      return code.substring(3).toLowerCase();
    }
    // Handle digit keys (Digit1, Digit2, etc.)
    if (code.startsWith('Digit')) {
      return code.substring(5);
    }
    // Handle special keys - convert to lowercase and use common names
    const specialKeys: Record<string, string> = {
      'Space': 'space',
      'Enter': 'enter',
      'Escape': 'escape',
      'Tab': 'tab',
      'Backspace': 'backspace',
      'Delete': 'delete',
      'ArrowUp': 'arrowup',
      'ArrowDown': 'arrowdown',
      'ArrowLeft': 'arrowleft',
      'ArrowRight': 'arrowright',
      'Home': 'home',
      'End': 'end',
      'PageUp': 'pageup',
      'PageDown': 'pagedown',
      'Insert': 'insert',
      'F1': 'f1', 'F2': 'f2', 'F3': 'f3', 'F4': 'f4',
      'F5': 'f5', 'F6': 'f6', 'F7': 'f7', 'F8': 'f8',
      'F9': 'f9', 'F10': 'f10', 'F11': 'f11', 'F12': 'f12',
    };
    return specialKeys[code] || code.toLowerCase();
  };

  // Keyboard Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      
      // Helper to check if shortcut matches
      const matchesShortcut = (config: ShortcutConfig): boolean => {
        if (config.ctrl && !(e.ctrlKey || e.metaKey)) return false;
        if (config.shift && !e.shiftKey) return false;
        if (config.alt && !e.altKey) return false;
        if (!config.ctrl && (e.ctrlKey || e.metaKey)) return false;
        if (!config.shift && e.shiftKey) return false;
        if (!config.alt && e.altKey) return false;
        
        // Use e.code to get English letter regardless of keyboard layout
        const englishKey = getEnglishKeyFromCode(e.code);
        const configKey = config.key.toLowerCase();
        return englishKey === configKey;
      };

      // Hide/Show UI shortcut should always work, even when UI is hidden or settings are open
      if (matchesShortcut(shortcuts.hideUI)) {
        e.preventDefault();
        e.stopPropagation();
        setIsUIHidden(prev => {
          const newState = !prev;
          // Close settings when hiding UI
          if (newState && isSettingsOpen) {
            setIsSettingsOpen(false);
          }
          return newState;
        });
        return;
      }

      // Other shortcuts should not work when settings modal is open or capturing
      if (isSettingsOpen || capturingShortcut) return;

      // Check each shortcut
      if (matchesShortcut(shortcuts.undo)) {
        e.preventDefault();
        e.stopPropagation();
        handleUndo();
      } else if (matchesShortcut(shortcuts.redo)) {
        e.preventDefault();
        e.stopPropagation();
        handleRedo();
      } else if (matchesShortcut(shortcuts.pen)) {
        e.preventDefault();
        e.stopPropagation();
        setTool('pen');
      } else if (matchesShortcut(shortcuts.eraser)) {
        e.preventDefault();
        e.stopPropagation();
        setTool('eraser');
      } else if (matchesShortcut(shortcuts.pan)) {
        e.preventDefault();
        e.stopPropagation();
        setTool('pan');
      } else if (matchesShortcut(shortcuts.clear)) {
        e.preventDefault();
        e.stopPropagation();
        clearCanvas();
      }
      
      // Delete/Backspace to remove selected strokes
      if ((key === 'delete' || key === 'backspace') && selectedStrokesRef.current.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        
        // Save current state to history before deleting
        saveToHistory();
        
        // Remove selected strokes (in reverse order to maintain indices)
        const indicesToRemove = Array.from(selectedStrokesRef.current).sort((a, b) => b - a);
        indicesToRemove.forEach((index) => {
          strokesRef.current.splice(index, 1);
        });
        
        // Clear selection
        selectedStrokesRef.current.clear();
        selectionBoundsRef.current = null;
        setUndoCount(historyRef.current.length);
        scheduleRedraw();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handleUndo, handleRedo, shortcuts, isSettingsOpen, capturingShortcut, clearCanvas, saveToHistory, scheduleRedraw]);

  useEffect(() => {
    if (capturingShortcut && captureInputRef.current) {
      captureInputRef.current.focus();
    }
  }, [capturingShortcut]);

  // Global keyboard handler for capturing shortcuts
  useEffect(() => {
    if (!capturingShortcut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys alone
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      // Use e.code to get English letter regardless of keyboard layout
      const englishKey = getEnglishKeyFromCode(e.code);
      
      const newConfig: ShortcutConfig = {
        key: englishKey,
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey
      };
      
      setShortcuts(prev => ({
        ...prev,
        [capturingShortcut]: newConfig
      }));
      
      setCapturingShortcut(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [capturingShortcut]);
  
  const handleShortcutKeyDown = (e: React.KeyboardEvent, shortcutKey: keyof Shortcuts) => {
    // Ignore modifier keys alone
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Use e.code to get English letter regardless of keyboard layout
    const englishKey = getEnglishKeyFromCode(e.code);
    
    const newConfig: ShortcutConfig = {
      key: englishKey,
      ctrl: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
      alt: e.altKey
    };
    
    setShortcuts(prev => ({
      ...prev,
      [shortcutKey]: newConfig
    }));
    
    setCapturingShortcut(null);
  };

  const resetShortcut = (shortcutKey: keyof Shortcuts) => {
    setShortcuts(prev => ({
      ...prev,
      [shortcutKey]: DEFAULT_SHORTCUTS[shortcutKey]
    }));
  };

  // Format shortcut for display
  const formatShortcut = (config: ShortcutConfig | undefined): string => {
    if (!config) return 'Not set';
    const parts: string[] = [];
    if (config.ctrl) parts.push('Ctrl');
    if (config.shift) parts.push('Shift');
    if (config.alt) parts.push('Alt');
    parts.push(config.key?.toUpperCase() || '?');
    return parts.join(' + ');
  };

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

  // Check if click is on a resize handle
  const getHandleAtPoint = (worldPos: Point): number | null => {
    if (!selectionBoundsRef.current || selectedStrokesRef.current.size === 0) return null;
    
    const { minX, minY, maxX, maxY } = selectionBoundsRef.current;
    const { scale } = transformRef.current;
    const handleSize = 8;
    const handleRadius = handleSize / scale; // Convert to world coordinates
    
    const corners = [
      { x: minX, y: minY }, // 0: top-left
      { x: maxX, y: minY }, // 1: top-right
      { x: maxX, y: maxY }, // 2: bottom-right
      { x: minX, y: maxY } // 3: bottom-left
    ];
    
    for (let i = 0; i < corners.length; i++) {
      const corner = corners[i];
      const dx = worldPos.x - corner.x;
      const dy = worldPos.y - corner.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= handleRadius) {
        return i;
      }
    }
    
    return null;
  };

  // Scale selected strokes
  const scaleSelectedStrokes = (scaleX: number, scaleY: number, centerX: number, centerY: number) => {
    if (selectedStrokesRef.current.size === 0) return;
    
    selectedStrokesRef.current.forEach((index) => {
      const stroke = strokesRef.current[index];
      if (!stroke) return;
      
      stroke.points = stroke.points.map((point) => {
        const dx = point.x - centerX;
        const dy = point.y - centerY;
        return {
          x: centerX + dx * scaleX,
          y: centerY + dy * scaleY
        };
      });
    });
    
    // Recalculate bounds
    if (selectionBoundsRef.current) {
      const { minX, minY, maxX, maxY } = selectionBoundsRef.current;
      const width = maxX - minX;
      const height = maxY - minY;
      const newWidth = width * scaleX;
      const newHeight = height * scaleY;
      const newMinX = centerX - (centerX - minX) * scaleX;
      const newMinY = centerY - (centerY - minY) * scaleY;
      
      selectionBoundsRef.current = {
        minX: newMinX,
        minY: newMinY,
        maxX: newMinX + newWidth,
        maxY: newMinY + newHeight
      };
    }
  };

  // Check if stroke intersects with selection rectangle
  const isStrokeInSelection = (stroke: Stroke, selectionStart: Point, selectionEnd: Point): boolean => {
    if (stroke.points.length === 0) return false;

    // Calculate bounding box of selection
    const selMinX = Math.min(selectionStart.x, selectionEnd.x);
    const selMaxX = Math.max(selectionStart.x, selectionEnd.x);
    const selMinY = Math.min(selectionStart.y, selectionEnd.y);
    const selMaxY = Math.max(selectionStart.y, selectionEnd.y);

    // Calculate bounding box of stroke
    let strokeMinX = Infinity;
    let strokeMaxX = -Infinity;
    let strokeMinY = Infinity;
    let strokeMaxY = -Infinity;

    for (const point of stroke.points) {
      strokeMinX = Math.min(strokeMinX, point.x);
      strokeMaxX = Math.max(strokeMaxX, point.x);
      strokeMinY = Math.min(strokeMinY, point.y);
      strokeMaxY = Math.max(strokeMaxY, point.y);
    }

    // Add stroke size to bounding box
    const halfSize = stroke.size / 2;
    strokeMinX -= halfSize;
    strokeMaxX += halfSize;
    strokeMinY -= halfSize;
    strokeMaxY += halfSize;

    // Check if bounding boxes intersect
    return !(strokeMaxX < selMinX || strokeMinX > selMaxX || strokeMaxY < selMinY || strokeMinY > selMaxY);
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    const isMouseEvent = 'button' in e;
    const isCtrlKey = isMouseEvent && ((e as React.MouseEvent).ctrlKey || (e as React.MouseEvent).metaKey);
    
    // Check if clicking on a resize handle
    if (selectedStrokesRef.current.size > 0 && selectionBoundsRef.current) {
      const pos = getPointerPos(e);
      const worldPos = toWorldPos(pos);
      const handleIndex = getHandleAtPoint(worldPos);
      
      if (handleIndex !== null) {
        e.preventDefault?.();
        e.stopPropagation?.();
        isResizingRef.current = true;
        resizeHandleRef.current = handleIndex;
        resizeStartBoundsRef.current = { ...selectionBoundsRef.current };
        resizeStartMouseRef.current = worldPos;
        
        // Store original strokes for resizing
        originalStrokesForResizeRef.current.clear();
        selectedStrokesRef.current.forEach((index) => {
          const stroke = strokesRef.current[index];
          if (stroke) {
            originalStrokesForResizeRef.current.set(index, {
              ...stroke,
              points: stroke.points.map(p => ({ ...p }))
            });
          }
        });
        
        saveToHistory();
        scheduleRedraw();
        return;
      }
    }
    
    // Pan tool with Ctrl -> Selection
    if (tool === 'pan' && isCtrlKey) {
        isSelectingRef.current = true;
        // Clear previous selection when starting new selection
        selectedStrokesRef.current.clear();
        selectionBoundsRef.current = null;
        const pos = getPointerPos(e);
        const worldPos = toWorldPos(pos);
        selectionStartRef.current = worldPos;
        selectionEndRef.current = worldPos;
        scheduleRedraw();
        return;
    }
    
    // Middle mouse or Space+Click or Pan tool -> Pan
    const isMiddleClick = isMouseEvent && (e as React.MouseEvent).button === 1;
    const isSpaceClick = isMouseEvent && (e as React.MouseEvent).shiftKey; 
    
    if (tool === 'pan' || isMiddleClick || isSpaceClick) {
        // Clear selection when starting pan without Ctrl
        if (tool === 'pan' && !isCtrlKey) {
            selectedStrokesRef.current.clear();
            selectionBoundsRef.current = null;
            scheduleRedraw();
        }
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
    const worldPos = toWorldPos(pos);
    
    // Update mouse position for coordinates display
    if (showCoordinates) {
      setMousePosition({ x: worldPos.x, y: worldPos.y });
    }

    // Check if hovering over a resize handle (when not resizing and tool is pan)
    if (!isResizingRef.current && tool === 'pan' && selectedStrokesRef.current.size > 0 && selectionBoundsRef.current) {
      const handleIndex = getHandleAtPoint(worldPos);
      if (handleIndex !== hoveredHandleRef.current) {
        hoveredHandleRef.current = handleIndex;
        // Update cursor via CSS class
        const canvas = canvasRef.current;
        if (canvas) {
          if (handleIndex !== null) {
            const cursors = ['nw-resize', 'ne-resize', 'se-resize', 'sw-resize'];
            canvas.style.cursor = cursors[handleIndex];
          } else {
            canvas.style.cursor = 'grab';
          }
        }
      }
    } else if (!isResizingRef.current && tool !== 'pan') {
      // Reset cursor for non-pan tools
      const canvas = canvasRef.current;
      if (canvas && hoveredHandleRef.current !== null) {
        hoveredHandleRef.current = null;
        canvas.style.cursor = 'crosshair';
      }
    }

    if (isResizingRef.current && resizeStartBoundsRef.current && resizeStartMouseRef.current && resizeHandleRef.current !== null) {
      const { minX, minY, maxX, maxY } = resizeStartBoundsRef.current;
      const currentX = worldPos.x;
      const currentY = worldPos.y;
      
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const width = maxX - minX;
      const height = maxY - minY;
      
      let newMinX = minX;
      let newMinY = minY;
      let newMaxX = maxX;
      let newMaxY = maxY;
      
      // Calculate new bounds based on handle
      switch (resizeHandleRef.current) {
        case 0: // top-left
          newMinX = Math.min(currentX, maxX - 1);
          newMinY = Math.min(currentY, maxY - 1);
          break;
        case 1: // top-right
          newMaxX = Math.max(currentX, minX + 1);
          newMinY = Math.min(currentY, maxY - 1);
          break;
        case 2: // bottom-right
          newMaxX = Math.max(currentX, minX + 1);
          newMaxY = Math.max(currentY, minY + 1);
          break;
        case 3: // bottom-left
          newMinX = Math.min(currentX, maxX - 1);
          newMaxY = Math.max(currentY, minY + 1);
          break;
      }
      
      const scaleX = width > 0 ? (newMaxX - newMinX) / width : 1;
      const scaleY = height > 0 ? (newMaxY - newMinY) / height : 1;
      
      // Scale strokes from original bounds
      if (selectedStrokesRef.current.size > 0 && originalStrokesForResizeRef.current.size > 0) {
        selectedStrokesRef.current.forEach((index) => {
          const stroke = strokesRef.current[index];
          const originalStroke = originalStrokesForResizeRef.current.get(index);
          if (!stroke || !originalStroke) return;
          
          stroke.points = originalStroke.points.map((point) => {
            const dx = point.x - centerX;
            const dy = point.y - centerY;
            return {
              x: centerX + dx * scaleX,
              y: centerY + dy * scaleY
            };
          });
        });
        
        // Recalculate bounds based on actual scaled strokes
        let recalcMinX = Infinity;
        let recalcMinY = Infinity;
        let recalcMaxX = -Infinity;
        let recalcMaxY = -Infinity;
        
        selectedStrokesRef.current.forEach((index) => {
          const stroke = strokesRef.current[index];
          if (!stroke || stroke.points.length === 0) return;
          
          const halfSize = stroke.size / 2;
          
          stroke.points.forEach((point) => {
            recalcMinX = Math.min(recalcMinX, point.x - halfSize);
            recalcMinY = Math.min(recalcMinY, point.y - halfSize);
            recalcMaxX = Math.max(recalcMaxX, point.x + halfSize);
            recalcMaxY = Math.max(recalcMaxY, point.y + halfSize);
          });
        });
        
        // Update bounds based on actual scaled objects
        if (recalcMinX !== Infinity) {
          selectionBoundsRef.current = {
            minX: recalcMinX,
            minY: recalcMinY,
            maxX: recalcMaxX,
            maxY: recalcMaxY
          };
        }
      } else {
        // Fallback: update bounds from handle position if no strokes
        selectionBoundsRef.current = {
          minX: newMinX,
          minY: newMinY,
          maxX: newMaxX,
          maxY: newMaxY
        };
      }
      
      scheduleRedraw();
      return;
    }

    if (isSelectingRef.current) {
        selectionEndRef.current = worldPos;
        scheduleRedraw();
        return;
    }

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
        currentStrokeRef.current.points.push(worldPos);
        scheduleRedraw();
    }
  };

  const handleEnd = () => {
    if (isResizingRef.current) {
        isResizingRef.current = false;
        resizeHandleRef.current = null;
        resizeStartBoundsRef.current = null;
        resizeStartMouseRef.current = null;
        originalStrokesForResizeRef.current.clear();
        
        // Recalculate bounds after resize
        if (selectedStrokesRef.current.size > 0 && selectionBoundsRef.current) {
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          
          selectedStrokesRef.current.forEach((index) => {
            const stroke = strokesRef.current[index];
            if (!stroke || stroke.points.length === 0) return;
            
            const halfSize = stroke.size / 2;
            
            stroke.points.forEach((point) => {
              minX = Math.min(minX, point.x - halfSize);
              minY = Math.min(minY, point.y - halfSize);
              maxX = Math.max(maxX, point.x + halfSize);
              maxY = Math.max(maxY, point.y + halfSize);
            });
          });
          
          if (minX !== Infinity) {
            selectionBoundsRef.current = { minX, minY, maxX, maxY };
          }
        }
        
        scheduleRedraw();
        return;
    }

    if (isSelectingRef.current) {
        isSelectingRef.current = false;
        
        // Determine which strokes are in the selection
        if (selectionStartRef.current && selectionEndRef.current) {
            selectedStrokesRef.current.clear();
            strokesRef.current.forEach((stroke, index) => {
                if (isStrokeInSelection(stroke, selectionStartRef.current!, selectionEndRef.current!)) {
                    selectedStrokesRef.current.add(index);
                }
            });
            
            // Calculate bounding box of all selected strokes
            if (selectedStrokesRef.current.size > 0) {
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;
                
                selectedStrokesRef.current.forEach((index) => {
                    const stroke = strokesRef.current[index];
                    if (!stroke || stroke.points.length === 0) return;
                    
                    const halfSize = stroke.size / 2;
                    
                    stroke.points.forEach((point) => {
                        minX = Math.min(minX, point.x - halfSize);
                        minY = Math.min(minY, point.y - halfSize);
                        maxX = Math.max(maxX, point.x + halfSize);
                        maxY = Math.max(maxY, point.y + halfSize);
                    });
                });
                
                if (minX !== Infinity) {
                    selectionBoundsRef.current = { minX, minY, maxX, maxY };
                } else {
                    selectionBoundsRef.current = null;
                }
            } else {
                selectionBoundsRef.current = null;
            }
        }
        
        // Clear selection rectangle visual (but keep selected strokes highlighted)
        selectionStartRef.current = null;
        selectionEndRef.current = null;
        scheduleRedraw();
        return;
    }

    if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
    }

    if (isDrawingRef.current && currentStrokeRef.current) {
        isDrawingRef.current = false;
        if (currentStrokeRef.current.points.length > 0) {
            // Save current state to history before adding new stroke
            saveToHistory();
            strokesRef.current.push(currentStrokeRef.current);
            setUndoCount(historyRef.current.length);
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

  return (
    <div ref={containerRef} className={`relative w-full h-full bg-white overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block touch-none w-full h-full"
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={(e) => {
          handleEnd();
          if (showCoordinates) {
            setMousePosition(null);
          }
        }}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
      />

      {/* Toolbar */}
      {!isUIHidden && (
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
        <button onClick={handleRedo} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title="Redo" disabled={redoCount === 0}>
            <Redo className={`w-4 h-4 ${redoCount === 0 ? 'opacity-30' : ''}`} />
        </button>
        <button onClick={clearCanvas} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-rose-100 hover:text-rose-600" title="Clear">
            <Minus className="w-4 h-4" />
        </button>
        
        <div className="w-px h-6 bg-slate-300"></div>
        
        <button onClick={() => setIsSettingsOpen(true)} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title="Settings">
            <Settings className="w-4 h-4" />
        </button>
      </div>
      )}

      {/* Display Info (Coordinates & Zoom) */}
      {!isUIHidden && (showCoordinates || showZoom) && (() => {
        const positionClasses = {
          'top-left': 'top-4 left-4',
          'top-right': 'top-4 right-4',
          'bottom-left': 'bottom-4 left-4',
          'bottom-right': 'bottom-4 right-4'
        };
        const sizeClasses = {
          'small': 'text-xs p-2',
          'medium': 'text-sm p-3',
          'large': 'text-base p-4'
        };
        return (
          <div className={`absolute ${positionClasses[displayPosition]} z-10 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-2xl shadow-lg ${sizeClasses[displaySize]} space-y-1`}>
            {showCoordinates && mousePosition && (
              <div className={`text-slate-600 font-mono ${displaySize === 'small' ? 'text-xs' : displaySize === 'medium' ? 'text-sm' : 'text-base'}`}>
                {mousePosition.x.toFixed(0)}, {mousePosition.y.toFixed(0)}
              </div>
            )}
            {showZoom && (
              <div className={`text-slate-600 font-mono ${displaySize === 'small' ? 'text-xs' : displaySize === 'medium' ? 'text-sm' : 'text-base'}`}>
                {(currentZoom * 100).toFixed(0)}%
              </div>
            )}
          </div>
        );
      })()}

      {/* Settings Modal */}
      {!isUIHidden && isSettingsOpen && createPortal(
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div className="absolute inset-0 bg-slate-200/50 backdrop-blur-sm transition-opacity" onClick={() => setIsSettingsOpen(false)}></div>
          <div 
            className="relative w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl ring-1 ring-black/5" 
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-800">Keyboard Shortcuts</h3>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {([
                { key: 'undo' as const, label: 'Undo', icon: <Undo className="w-4 h-4" /> },
                { key: 'redo' as const, label: 'Redo', icon: <Redo className="w-4 h-4" /> },
                { key: 'pen' as const, label: 'Pen Tool', icon: <PenTool className="w-4 h-4" /> },
                { key: 'eraser' as const, label: 'Eraser Tool', icon: <Eraser className="w-4 h-4" /> },
                { key: 'pan' as const, label: 'Pan Tool', icon: <Move className="w-4 h-4" /> },
                { key: 'clear' as const, label: 'Clear Canvas', icon: <Minus className="w-4 h-4" /> },
                { key: 'hideUI' as const, label: 'Hide/Show UI', icon: isUIHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" /> },
              ]).map(({ key, label, icon }) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="text-slate-400">
                      {icon}
                    </div>
                    <div>
                      <div className="text-sm text-slate-700">{label}</div>
                      {capturingShortcut === key ? (
                        <div className="text-xs text-slate-500 mt-0.5">Press any key combination...</div>
                      ) : (
                        <div className="text-xs text-slate-400 mt-0.5">{formatShortcut(shortcuts[key] || DEFAULT_SHORTCUTS[key])}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {capturingShortcut === key ? (
                      <button
                        onClick={() => setCapturingShortcut(null)}
                        className="px-2 py-1 text-xs text-slate-600 hover:text-slate-800 transition"
                      >
                        Cancel
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => setCapturingShortcut(key)}
                          className="px-2 py-1 text-xs text-slate-600 hover:text-slate-800 transition"
                        >
                          Change
                        </button>
                        <button
                          onClick={() => resetShortcut(key)}
                          className="px-2 py-1 text-xs text-slate-400 hover:text-slate-600 transition"
                          title="Reset to default"
                        >
                          Reset
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {capturingShortcut && (
              <div 
                ref={captureInputRef}
                className="mt-4 py-2 outline-none"
                onKeyDown={(e) => handleShortcutKeyDown(e, capturingShortcut)}
                tabIndex={0}
              >
                <div className="text-xs text-slate-600">Press your desired key combination</div>
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="space-y-2">
                <div 
                  className="flex items-center justify-between py-2 border-b border-slate-100 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded transition-colors"
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                >
                  <div className="text-sm text-slate-700">Advanced Settings</div>
                  <div className="flex items-center gap-1">
                    {showAdvancedSettings ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                </div>
                {showAdvancedSettings && (
                  <>
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <div>
                        <div className="text-sm text-slate-700">Show Coordinates</div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={showCoordinates}
                          onChange={(e) => setShowCoordinates(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-900"></div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <div>
                        <div className="text-sm text-slate-700">Show Zoom</div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={showZoom}
                          onChange={(e) => setShowZoom(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-900"></div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <div>
                        <div className="text-sm text-slate-700">Background</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {backgroundType === 'solid' && 'Solid'}
                          {backgroundType === 'grid' && 'Grid Lines'}
                          {backgroundType === 'dots' && 'Dot Grid'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {(['solid', 'grid', 'dots'] as const).map((type) => (
                          <button
                            key={type}
                            onClick={(e) => {
                              e.stopPropagation();
                              setBackgroundType(type);
                            }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                              backgroundType === type
                                ? 'bg-slate-900 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {type === 'solid' && 'Solid'}
                            {type === 'grid' && 'Grid'}
                            {type === 'dots' && 'Dots'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-slate-100">
                      <div className="flex-1">
                        <div className="text-sm text-slate-700 mb-2">Zoom Speed</div>
                        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="range"
                            min="0.0001"
                            max="0.01"
                            step="0.0001"
                            value={zoomSpeed}
                            onChange={(e) => setZoomSpeed(parseFloat(e.target.value))}
                            className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-800"
                          />
                          <span className="text-xs text-slate-500 font-mono min-w-[60px] text-right">
                            {zoomSpeed.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {(showCoordinates || showZoom) && (
                      <>
                        <div className="flex items-center justify-between py-2 border-b border-slate-100">
                          <div>
                            <div className="text-sm text-slate-700">Position</div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {displayPosition === 'top-left' && 'Top Left'}
                              {displayPosition === 'top-right' && 'Top Right'}
                              {displayPosition === 'bottom-left' && 'Bottom Left'}
                              {displayPosition === 'bottom-right' && 'Bottom Right'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((pos) => (
                              <button
                                key={pos}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDisplayPosition(pos);
                                }}
                                className={`px-2 py-1 text-xs text-slate-600 hover:text-slate-800 transition ${
                                  displayPosition === pos ? 'text-slate-800' : ''
                                }`}
                              >
                                {pos.split('-').map(w => w[0].toUpperCase()).join('')}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-slate-100">
                          <div>
                            <div className="text-sm text-slate-700">Size</div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {displaySize === 'small' && 'Small'}
                              {displaySize === 'medium' && 'Medium'}
                              {displaySize === 'large' && 'Large'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {(['small', 'medium', 'large'] as const).map((size) => (
                              <button
                                key={size}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDisplaySize(size);
                                }}
                                className={`px-2 py-1 text-xs text-slate-600 hover:text-slate-800 transition ${
                                  displaySize === size ? 'text-slate-800' : ''
                                }`}
                              >
                                {size.charAt(0).toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="w-full py-2 mt-4 text-sm text-slate-700 hover:text-slate-900 transition"
            >
              Done
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

Whiteboard.displayName = 'Whiteboard';
