import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PenTool, Eraser, Move, Undo, Palette, Minus, X, ArrowRight, Square, Circle, Type, MousePointer2 } from 'lucide-react';
import { DebouncedColorInput } from '../common/DebouncedColorInput';
import { STORAGE_KEYS } from '../../constants';

interface Transform {
  scale: number;
  offset: { x: number; y: number };
}

interface WhiteboardProps {
  className?: string;
  transform: Transform;
  onTransformChange: (transform: Transform) => void;
}

interface Point {
  x: number;
  y: number;
}

type ElementType = 'pencil' | 'eraser' | 'line' | 'arrow' | 'rectangle' | 'circle' | 'text';

interface CanvasElement {
  id: string;
  type: ElementType;
  x: number;      // Start point / TopLeft
  y: number;      // Start point / TopLeft
  endX?: number;  // For geometric shapes
  endY?: number;  // For geometric shapes
  points?: Point[]; // Only for pencil
  text?: string;  // For text elements
  color: string;
  size: number;
  fontFamily?: string;
  fontSize?: number;
}

// Coordinate conversion utilities
const screenToWorld = (screenX: number, screenY: number, scale: number, offset: { x: number; y: number }): Point => {
  return {
    x: (screenX - offset.x) / scale,
    y: (screenY - offset.y) / scale
  };
};

const worldToScreen = (worldX: number, worldY: number, scale: number, offset: { x: number; y: number }): Point => {
  return {
    x: worldX * scale + offset.x,
    y: worldY * scale + offset.y
  };
};

// Calculate bounding box for an element
const getElementBounds = (element: CanvasElement): { minX: number; minY: number; maxX: number; maxY: number } => {
  if ((element.type === 'pencil' || element.type === 'eraser') && element.points && element.points.length > 0) {
    let minX = element.points[0].x;
    let minY = element.points[0].y;
    let maxX = element.points[0].x;
    let maxY = element.points[0].y;
    
    for (const point of element.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    
    return { minX, minY, maxX, maxY };
  } else if (element.endX !== undefined && element.endY !== undefined) {
    return {
      minX: Math.min(element.x, element.endX),
      minY: Math.min(element.y, element.endY),
      maxX: Math.max(element.x, element.endX),
      maxY: Math.max(element.y, element.endY)
    };
  } else if (element.type === 'text' && element.text) {
    // For text, we'll approximate bounds (will be refined with actual text metrics if needed)
    const textWidth = (element.text.length * (element.fontSize || 16)) * 0.6;
    const textHeight = element.fontSize || 16;
    return {
      minX: element.x,
      minY: element.y - textHeight,
      maxX: element.x + textWidth,
      maxY: element.y
    };
  }
  
  return { minX: element.x, minY: element.y, maxX: element.x, maxY: element.y };
};

// Distance from point to line segment
const pointToLineDistance = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) {
    param = dot / lenSq;
  }
  
  let xx, yy;
  
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
};

// Hit testing function
const getElementAtPosition = (
  worldX: number,
  worldY: number,
  elements: CanvasElement[],
  hitThreshold: number = 5
): CanvasElement | null => {
  // Check in reverse order (top to bottom)
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    const bounds = getElementBounds(element);
    
    // First check bounding box (optimization for pencil strokes)
    if (worldX < bounds.minX - hitThreshold || worldX > bounds.maxX + hitThreshold ||
        worldY < bounds.minY - hitThreshold || worldY > bounds.maxY + hitThreshold) {
      continue;
    }
    
    // Detailed hit testing
    if ((element.type === 'pencil' || element.type === 'eraser') && element.points) {
      // Check distance to any point in the path
      for (const point of element.points) {
        const dist = Math.sqrt((worldX - point.x) ** 2 + (worldY - point.y) ** 2);
        if (dist <= hitThreshold) {
          return element;
        }
      }
    } else if (element.type === 'line' && element.endX !== undefined && element.endY !== undefined) {
      const dist = pointToLineDistance(worldX, worldY, element.x, element.y, element.endX, element.endY);
      if (dist <= hitThreshold) {
        return element;
      }
    } else if (element.type === 'arrow' && element.endX !== undefined && element.endY !== undefined) {
      const dist = pointToLineDistance(worldX, worldY, element.x, element.y, element.endX, element.endY);
      if (dist <= hitThreshold) {
        return element;
      }
    } else if (element.type === 'rectangle' && element.endX !== undefined && element.endY !== undefined) {
      // Point in rectangle check
      if (worldX >= bounds.minX && worldX <= bounds.maxX &&
          worldY >= bounds.minY && worldY <= bounds.maxY) {
        return element;
      }
    } else if (element.type === 'circle' && element.endX !== undefined && element.endY !== undefined) {
      const centerX = (element.x + element.endX) / 2;
      const centerY = (element.y + element.endY) / 2;
      const radiusX = Math.abs(element.endX - element.x) / 2;
      const radiusY = Math.abs(element.endY - element.y) / 2;
      const radius = Math.max(radiusX, radiusY);
      
      const dist = Math.sqrt((worldX - centerX) ** 2 + (worldY - centerY) ** 2);
      if (Math.abs(dist - radius) <= hitThreshold) {
        return element;
      }
    } else if (element.type === 'text' && element.text) {
      // Point in text bounding box
      if (worldX >= bounds.minX && worldX <= bounds.maxX &&
          worldY >= bounds.minY && worldY <= bounds.maxY) {
        return element;
      }
    }
  }
  
  return null;
};

export const Whiteboard: React.FC<WhiteboardProps> = ({ className = "", transform, onTransformChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement>(null);
  const elementsRef = useRef<CanvasElement[]>([]);
  const currentElementRef = useRef<CanvasElement | null>(null);
  
  // History system
  const historyRef = useRef<CanvasElement[][]>([]);
  const historyIndexRef = useRef<number>(0);
  const redoStackRef = useRef<CanvasElement[][]>([]);
  const MAX_HISTORY_STEPS = 50;
  const historyInitializedRef = useRef(false);
  
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  // Initialize history with empty state
  useEffect(() => {
    if (!historyInitializedRef.current) {
      historyRef.current = [JSON.parse(JSON.stringify(elementsRef.current))];
      historyIndexRef.current = 1;
      historyInitializedRef.current = true;
    }
  }, []);
  const [tool, setTool] = useState<'pen' | 'eraser' | 'pan' | 'line' | 'arrow' | 'rectangle' | 'circle' | 'text' | 'select'>('pen');
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(3);
  const [showDebug, setShowDebug] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [textInputState, setTextInputState] = useState<{ x: number; y: number; worldX: number; worldY: number; elementId: string | null } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [tick, setTick] = useState(0);

  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragElementStartPosRef = useRef<{ x: number; y: number; endX?: number; endY?: number; points?: Point[] }>({ x: 0, y: 0 });
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const staticRedrawRequestRef = useRef<number | null>(null);
  const activeRedrawRequestRef = useRef<number | null>(null);
  const isStaticScheduledRef = useRef(false);
  const isActiveScheduledRef = useRef(false);

  const colors = ['#000000', '#FF0000', '#0000FF', '#00FF00'];

  // Debounce utility for localStorage saves
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEYS.WHITEBOARD, JSON.stringify(elementsRef.current));
      } catch (error) {
        console.error('Failed to save whiteboard data:', error);
      }
    }, 250);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Render a single element
  const renderElement = useCallback((ctx: CanvasRenderingContext2D, element: CanvasElement, transformScale: number = 1) => {
    ctx.save();
    
    if (element.type === 'pencil' && element.points) {
      if (element.points.length < 2) {
        ctx.restore();
        return;
      }
      
      ctx.beginPath();
      ctx.strokeStyle = element.color;
      ctx.lineWidth = element.size / transformScale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'source-over';

      ctx.moveTo(element.points[0].x, element.points[0].y);
      for (let i = 1; i < element.points.length; i++) {
        ctx.lineTo(element.points[i].x, element.points[i].y);
      }
      ctx.stroke();
    } else if (element.type === 'eraser' && element.points) {
      if (element.points.length < 2) {
        ctx.restore();
        return;
      }
      
      ctx.beginPath();
      ctx.strokeStyle = element.color;
      ctx.lineWidth = element.size / transformScale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'destination-out';

      ctx.moveTo(element.points[0].x, element.points[0].y);
      for (let i = 1; i < element.points.length; i++) {
        ctx.lineTo(element.points[i].x, element.points[i].y);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    } else if (element.type === 'line' && element.endX !== undefined && element.endY !== undefined) {
      ctx.beginPath();
      ctx.strokeStyle = element.color;
      ctx.lineWidth = element.size / transformScale;
      ctx.moveTo(element.x, element.y);
      ctx.lineTo(element.endX, element.endY);
      ctx.stroke();
    } else if (element.type === 'arrow' && element.endX !== undefined && element.endY !== undefined) {
      // Draw line
      ctx.beginPath();
      ctx.strokeStyle = element.color;
      ctx.lineWidth = element.size / transformScale;
      ctx.moveTo(element.x, element.y);
      ctx.lineTo(element.endX, element.endY);
      ctx.stroke();
      
      // Draw arrowhead
      const angle = Math.atan2(element.endY - element.y, element.endX - element.x);
      const arrowLength = element.size * 3;
      const arrowAngle = Math.PI / 6; // 30 degrees
      
      ctx.beginPath();
      ctx.fillStyle = element.color;
      ctx.moveTo(element.endX, element.endY);
      ctx.lineTo(
        element.endX - arrowLength * Math.cos(angle - arrowAngle),
        element.endY - arrowLength * Math.sin(angle - arrowAngle)
      );
      ctx.lineTo(
        element.endX - arrowLength * Math.cos(angle + arrowAngle),
        element.endY - arrowLength * Math.sin(angle + arrowAngle)
      );
      ctx.closePath();
      ctx.fill();
    } else if (element.type === 'rectangle' && element.endX !== undefined && element.endY !== undefined) {
      ctx.strokeStyle = element.color;
      ctx.lineWidth = element.size / transformScale;
      const width = element.endX - element.x;
      const height = element.endY - element.y;
      ctx.strokeRect(element.x, element.y, width, height);
    } else if (element.type === 'circle' && element.endX !== undefined && element.endY !== undefined) {
      const centerX = (element.x + element.endX) / 2;
      const centerY = (element.y + element.endY) / 2;
      const radiusX = Math.abs(element.endX - element.x) / 2;
      const radiusY = Math.abs(element.endY - element.y) / 2;
      const radius = Math.max(radiusX, radiusY);
      
      ctx.beginPath();
      ctx.strokeStyle = element.color;
      ctx.lineWidth = element.size / transformScale;
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (element.type === 'text' && element.text) {
      ctx.font = `${element.fontSize || 16}px ${element.fontFamily || 'Arial'}`;
      ctx.fillStyle = element.color;
      ctx.fillText(element.text, element.x, element.y);
    }
    
    ctx.restore();
  }, []);

  // Redraw static canvas (completed elements + grid)
  const redrawStatic = useCallback(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const { scale, offset } = transform;

    // Clear and set transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    
    ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);

    // Draw grid if enabled
    if (showGrid) {
      ctx.save();
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1 / scale;
      
      // Calculate grid spacing based on scale (adaptive)
      const baseSpacing = 50;
      const gridSpacing = baseSpacing;
      
      // Calculate visible area in world coordinates
      const worldLeft = -offset.x / scale;
      const worldTop = -offset.y / scale;
      const worldRight = (width / (window.devicePixelRatio || 1) - offset.x) / scale;
      const worldBottom = (height / (window.devicePixelRatio || 1) - offset.y) / scale;
      
      // Draw vertical lines
      const startX = Math.floor(worldLeft / gridSpacing) * gridSpacing;
      const endX = Math.ceil(worldRight / gridSpacing) * gridSpacing;
      for (let x = startX; x <= endX; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, worldTop);
        ctx.lineTo(x, worldBottom);
        ctx.stroke();
      }
      
      // Draw horizontal lines
      const startY = Math.floor(worldTop / gridSpacing) * gridSpacing;
      const endY = Math.ceil(worldBottom / gridSpacing) * gridSpacing;
      for (let y = startY; y <= endY; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(worldLeft, y);
        ctx.lineTo(worldRight, y);
        ctx.stroke();
      }
      
      ctx.restore();
    }

    elementsRef.current.forEach(element => {
      renderElement(ctx, element, transform.scale);
    });
  }, [transform, renderElement, showGrid]);

  // Redraw active canvas (current drawing + selection)
  const redrawActive = useCallback(() => {
    const canvas = activeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const { scale, offset } = transform;

    // Clear and set transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    
    ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);
    
    // Draw current element being drawn
    if (currentElementRef.current) {
      renderElement(ctx, currentElementRef.current, transform.scale);
    }
    
    // Draw selection bounding box
    if (selectedElementId) {
      const selectedElement = elementsRef.current.find(el => el.id === selectedElementId);
      if (selectedElement) {
        const bounds = getElementBounds(selectedElement);
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, offset.x, offset.y);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1 / scale; // Scale-independent line width
        ctx.setLineDash([5 / scale, 5 / scale]);
        ctx.strokeRect(
          bounds.minX - 5 / scale,
          bounds.minY - 5 / scale,
          bounds.maxX - bounds.minX + 10 / scale,
          bounds.maxY - bounds.minY + 10 / scale
        );
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }, [transform, renderElement, selectedElementId]);

  const scheduleStaticRedraw = useCallback(() => {
    if (!isStaticScheduledRef.current) {
        isStaticScheduledRef.current = true;
        if (staticRedrawRequestRef.current !== null) {
            cancelAnimationFrame(staticRedrawRequestRef.current);
        }
        staticRedrawRequestRef.current = requestAnimationFrame(() => {
            redrawStatic();
            isStaticScheduledRef.current = false;
            staticRedrawRequestRef.current = null;
        });
    }
  }, [redrawStatic]);

  const scheduleActiveRedraw = useCallback(() => {
    if (!isActiveScheduledRef.current) {
        isActiveScheduledRef.current = true;
        if (activeRedrawRequestRef.current !== null) {
            cancelAnimationFrame(activeRedrawRequestRef.current);
        }
        activeRedrawRequestRef.current = requestAnimationFrame(() => {
            redrawActive();
            isActiveScheduledRef.current = false;
            activeRedrawRequestRef.current = null;
        });
    }
  }, [redrawActive]);

  // Save current state to history
  const saveToHistory = useCallback(() => {
    // Deep clone current elements
    const snapshot = JSON.parse(JSON.stringify(elementsRef.current));
    
    // Remove any future history if we're not at the end
    if (historyIndexRef.current < historyRef.current.length) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current);
    }
    
    // Add new snapshot
    historyRef.current.push(snapshot);
    historyIndexRef.current = historyRef.current.length;
    
    // Enforce 50-step limit
    if (historyRef.current.length > MAX_HISTORY_STEPS) {
      historyRef.current.shift();
      historyIndexRef.current--;
    }
    
    // Clear redo stack
    redoStackRef.current = [];
    setRedoCount(0);
    setUndoCount(historyRef.current.length > 1 ? historyRef.current.length - 1 : 0);
  }, []);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      // Save current state to redo stack
      const currentSnapshot = JSON.parse(JSON.stringify(elementsRef.current));
      redoStackRef.current.push(currentSnapshot);
      setRedoCount(redoStackRef.current.length);
      
      // Move back in history
      historyIndexRef.current--;
      const previousSnapshot = historyRef.current[historyIndexRef.current - 1];
      
      if (previousSnapshot) {
        elementsRef.current = JSON.parse(JSON.stringify(previousSnapshot));
        setUndoCount(historyIndexRef.current > 0 ? historyIndexRef.current - 1 : 0);
        debouncedSave();
        scheduleStaticRedraw();
      }
    }
  }, [scheduleStaticRedraw, debouncedSave]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length > 0) {
      // Pop from redo stack
      const nextSnapshot = redoStackRef.current.pop();
      setRedoCount(redoStackRef.current.length);
      
      if (nextSnapshot) {
        // Add to history
        historyRef.current.push(JSON.parse(JSON.stringify(nextSnapshot)));
        historyIndexRef.current = historyRef.current.length;
        
        // Restore state
        elementsRef.current = JSON.parse(JSON.stringify(nextSnapshot));
        setUndoCount(historyIndexRef.current > 1 ? historyIndexRef.current - 1 : 0);
        debouncedSave();
        scheduleStaticRedraw();
      }
    }
  }, [scheduleStaticRedraw, debouncedSave]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
        const container = containerRef.current;
        const staticCanvas = staticCanvasRef.current;
        const activeCanvas = activeCanvasRef.current;
        if (!container || !staticCanvas || !activeCanvas) return;
        
        const { width, height } = container.getBoundingClientRect();
        // Handle high DPI
        const dpr = window.devicePixelRatio || 1;
        
        staticCanvas.width = width * dpr;
        staticCanvas.height = height * dpr;
        staticCanvas.style.width = `${width}px`;
        staticCanvas.style.height = `${height}px`;
        
        activeCanvas.width = width * dpr;
        activeCanvas.height = height * dpr;
        activeCanvas.style.width = `${width}px`;
        activeCanvas.style.height = `${height}px`;
        
        scheduleStaticRedraw();
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
  }, [scheduleStaticRedraw]);

  // Load whiteboard data from localStorage on mount
  const dataLoadedRef = useRef(false);
  useEffect(() => {
    if (!dataLoadedRef.current) {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.WHITEBOARD);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            elementsRef.current = parsed;
            dataLoadedRef.current = true;
            scheduleStaticRedraw();
          }
        } else {
          dataLoadedRef.current = true;
        }
      } catch (error) {
        console.error('Failed to load whiteboard data:', error);
        dataLoadedRef.current = true;
      }
    }
  }, [scheduleStaticRedraw]);

  // Redraw static canvas when transform or elements change
  useEffect(() => {
    scheduleStaticRedraw();
  }, [transform, scheduleStaticRedraw]);

  // Wheel Handler (Zoom & Pan)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const { scale, offset } = transform;
      const canvas = staticCanvasRef.current;
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
        
        onTransformChange({
          scale: newScale,
          offset: { x: newOffsetX, y: newOffsetY }
        });
        
        setTick(t => t + 1);
      } else {
        // Pan
        const dpr = window.devicePixelRatio || 1;
        const newOffsetX = offset.x - e.deltaX * dpr;
        const newOffsetY = offset.y - e.deltaY * dpr;

        onTransformChange({
          scale,
          offset: { x: newOffsetX, y: newOffsetY }
        });

        setTick(t => t + 1);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
        container.removeEventListener('wheel', handleWheel);
    };
  }, [transform, onTransformChange]);

  const handleDelete = useCallback(() => {
    if (selectedElementId) {
      saveToHistory();
      elementsRef.current = elementsRef.current.filter(el => el.id !== selectedElementId);
      setSelectedElementId(null);
      debouncedSave();
      scheduleStaticRedraw();
      scheduleActiveRedraw();
    }
  }, [selectedElementId, scheduleStaticRedraw, scheduleActiveRedraw, saveToHistory, debouncedSave]);

  // Keyboard Handler (Undo, Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Robust Ctrl+Z check
      const isZ = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z';
      const isY = e.code === 'KeyY' || e.key === 'y' || e.key === 'Y';
      
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && isZ) {
        e.preventDefault();
        e.stopPropagation();
        handleUndo();
      }
      
      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && isZ) || (!e.shiftKey && isY))) {
        e.preventDefault();
        e.stopPropagation();
        handleRedo();
      }
      
      // Delete/Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementId) {
        e.preventDefault();
        e.stopPropagation();
        handleDelete();
      }
      
      // Escape - clear selection
      if (e.key === 'Escape') {
        setSelectedElementId(null);
        scheduleActiveRedraw();
      }
      
      // Brush size: [ and ]
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        setSize(prev => {
          const newSize = prev + (e.key === '[' ? -1 : 1);
          return Math.max(1, Math.min(20, newSize));
        });
      }
    };

    // Use window with capture to ensure we get the event
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handleUndo, handleRedo, handleDelete, selectedElementId, scheduleActiveRedraw]);

  // Mouse / Touch Handlers
  const getPointerPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = staticCanvasRef.current;
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

    const pos = getPointerPos(e);
    const worldPos = screenToWorld(pos.x, pos.y, transform.scale, transform.offset);

    // Selection tool
    if (tool === 'select') {
      const hitElement = getElementAtPosition(worldPos.x, worldPos.y, elementsRef.current, 5 / transform.scale);
      if (hitElement) {
        setSelectedElementId(hitElement.id);
        isDraggingRef.current = true;
        dragStartPosRef.current = worldPos;
        const element = elementsRef.current.find(el => el.id === hitElement.id);
        if (element) {
          dragElementStartPosRef.current = {
            x: element.x,
            y: element.y,
            endX: element.endX,
            endY: element.endY,
            points: element.points ? JSON.parse(JSON.stringify(element.points)) : undefined
          };
        }
        scheduleActiveRedraw();
        return;
      } else {
        setSelectedElementId(null);
      }
    }

    // Text tool
    if (tool === 'text') {
      const canvas = staticCanvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const screenPos = worldToScreen(worldPos.x, worldPos.y, transform.scale, transform.offset);
        setTextInputState({
          x: rect.left + screenPos.x / (window.devicePixelRatio || 1),
          y: rect.top + screenPos.y / (window.devicePixelRatio || 1),
          worldX: worldPos.x,
          worldY: worldPos.y,
          elementId: null
        });
      }
      return;
    }

    isDrawingRef.current = true;
    
    if (tool === 'pen' || tool === 'eraser') {
      currentElementRef.current = {
        id: Date.now().toString(),
        type: tool === 'eraser' ? 'eraser' : 'pencil',
        x: worldPos.x,
        y: worldPos.y,
        points: [worldPos],
        color: tool === 'eraser' ? '#FFFFFF' : color,
        size
      };
    } else if (tool === 'line' || tool === 'arrow' || tool === 'rectangle' || tool === 'circle') {
      currentElementRef.current = {
        id: Date.now().toString(),
        type: tool,
        x: worldPos.x,
        y: worldPos.y,
        endX: worldPos.x,
        endY: worldPos.y,
        color,
        size
      };
    }
    scheduleActiveRedraw();
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getPointerPos(e);

    if (isPanningRef.current) {
        const dx = pos.x - lastMousePosRef.current.x;
        const dy = pos.y - lastMousePosRef.current.y;
        const { scale, offset } = transform;
        
        onTransformChange({
            scale,
            offset: { x: offset.x + dx, y: offset.y + dy }
        });
        lastMousePosRef.current = pos;
        setTick(t => t + 1);
        return;
    }

    if (isDraggingRef.current && selectedElementId) {
      const worldPos = screenToWorld(pos.x, pos.y, transform.scale, transform.offset);
      const deltaX = worldPos.x - dragStartPosRef.current.x;
      const deltaY = worldPos.y - dragStartPosRef.current.y;
      
      const element = elementsRef.current.find(el => el.id === selectedElementId);
      if (element) {
        // Update position
        element.x = dragElementStartPosRef.current.x + deltaX;
        element.y = dragElementStartPosRef.current.y + deltaY;
        
        // Update end position for geometric shapes
        if (element.endX !== undefined && element.endY !== undefined) {
          element.endX = dragElementStartPosRef.current.endX + deltaX;
          element.endY = dragElementStartPosRef.current.endY + deltaY;
        }
        
        // Update all points for pencil strokes
        if (element.points && dragElementStartPosRef.current.points) {
          element.points = dragElementStartPosRef.current.points.map(p => ({
            x: p.x + deltaX,
            y: p.y + deltaY
          }));
        }
        
        scheduleStaticRedraw();
        scheduleActiveRedraw();
      }
      return;
    }

    if (isDrawingRef.current && currentElementRef.current) {
        const worldPos = screenToWorld(pos.x, pos.y, transform.scale, transform.offset);
        
        if (currentElementRef.current.type === 'pencil' && currentElementRef.current.points) {
          currentElementRef.current.points.push(worldPos);
        } else if (currentElementRef.current.endX !== undefined && currentElementRef.current.endY !== undefined) {
          currentElementRef.current.endX = worldPos.x;
          currentElementRef.current.endY = worldPos.y;
        }
        scheduleActiveRedraw();
    }
  };

  const handleEnd = () => {
    if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
    }

    if (isDraggingRef.current) {
        isDraggingRef.current = false;
        saveToHistory();
        debouncedSave();
        scheduleStaticRedraw();
        scheduleActiveRedraw();
        return;
    }

    if (isDrawingRef.current && currentElementRef.current) {
        isDrawingRef.current = false;
        
        // Validate element before adding
        let isValid = false;
        if ((currentElementRef.current.type === 'pencil' || currentElementRef.current.type === 'eraser') && currentElementRef.current.points && currentElementRef.current.points.length > 1) {
          isValid = true;
        } else if (currentElementRef.current.endX !== undefined && currentElementRef.current.endY !== undefined) {
          // For geometric shapes, check if there's actual size
          const dx = currentElementRef.current.endX - currentElementRef.current.x;
          const dy = currentElementRef.current.endY - currentElementRef.current.y;
          isValid = Math.abs(dx) > 1 || Math.abs(dy) > 1;
        }
        
        if (isValid) {
          saveToHistory();
          elementsRef.current.push(currentElementRef.current);
          debouncedSave();
        }
        currentElementRef.current = null;
        scheduleStaticRedraw();
        // Clear active canvas
        const activeCanvas = activeCanvasRef.current;
        if (activeCanvas) {
            const ctx = activeCanvas.getContext('2d');
            if (ctx) {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
            }
        }
    }
  };

  const resetView = () => {
    onTransformChange({ scale: 1, offset: { x: 0, y: 0 } });
    setTick(t => t + 1);
  };

  const clearCanvas = () => {
    elementsRef.current = [];
    setUndoCount(0);
    scheduleStaticRedraw();
  };

  const handleTextCommit = useCallback((text: string) => {
    if (!textInputState || !text.trim()) {
      setTextInputState(null);
      return;
    }

    const canvas = staticCanvasRef.current;
    if (!canvas) {
      setTextInputState(null);
      return;
    }

    const newElement: CanvasElement = {
      id: Date.now().toString(),
      type: 'text',
      x: textInputState.worldX,
      y: textInputState.worldY,
      text: text.trim(),
      color,
      size,
      fontFamily: 'Arial',
      fontSize: 16
    };

    saveToHistory();
    elementsRef.current.push(newElement);
    debouncedSave();
    setTextInputState(null);
    scheduleStaticRedraw();
  }, [textInputState, transform, color, size, saveToHistory, scheduleStaticRedraw, debouncedSave]);

  // Update text input position when transform changes
  useEffect(() => {
    if (textInputState) {
      const canvas = staticCanvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const screenPos = worldToScreen(textInputState.worldX, textInputState.worldY, transform.scale, transform.offset);
        setTextInputState({
          ...textInputState,
          x: rect.left + screenPos.x / (window.devicePixelRatio || 1),
          y: rect.top + screenPos.y / (window.devicePixelRatio || 1)
        });
      }
    }
  }, [transform]);

  // Focus textarea when it appears
  useEffect(() => {
    if (textInputState && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [textInputState]);

  return (
    <div ref={containerRef} className={`relative w-full h-full bg-white overflow-hidden ${className}`}>
      {/* Static Canvas - Completed elements (z-index: 1) */}
      <canvas
        ref={staticCanvasRef}
        className="absolute inset-0 block touch-none w-full h-full"
        style={{ zIndex: 1 }}
      />
      
      {/* Active Canvas - Current drawing (z-index: 2) */}
      <canvas
        ref={activeCanvasRef}
        className={`absolute inset-0 block touch-none w-full h-full ${tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
        style={{ zIndex: 2 }}
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
      />

      {/* Text Input Overlay (z-index: 3) */}
      {textInputState && (
        <textarea
          ref={textareaRef}
          className="absolute border-2 border-blue-500 bg-white/95 rounded px-2 py-1 resize-none outline-none"
          style={{
            left: `${textInputState.x}px`,
            top: `${textInputState.y}px`,
            zIndex: 3,
            fontSize: '16px',
            fontFamily: 'Arial',
            minWidth: '200px',
            minHeight: '30px'
          }}
          onBlur={(e) => {
            handleTextCommit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleTextCommit(e.currentTarget.value);
            } else if (e.key === 'Escape') {
              setTextInputState(null);
            }
          }}
          placeholder="Enter text..."
          autoFocus
        />
      )}

      {/* Debug Info */}
      <div className="absolute top-4 right-4 z-20">
        {showDebug ? (
            <div className="bg-black/90 text-white text-xs font-mono rounded-lg p-3 space-y-2 max-w-md">
                <div className="flex justify-between items-center mb-2">
                    <span className="font-bold">Debug</span>
                    <button onClick={() => setShowDebug(false)} className="text-white/70 hover:text-white"><X className="w-3 h-3" /></button>
                </div>
                <div>Objects: {elementsRef.current.length}</div>
                <div>Scale: {transform.scale.toFixed(2)}x</div>
                <div>Offset: {Math.round(transform.offset.x)}, {Math.round(transform.offset.y)}</div>
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
        <button onClick={() => setTool('select')} className={`p-2 rounded-lg transition-all ${tool === 'select' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="Select">
            <MousePointer2 className="w-4 h-4" />
        </button>
        <button onClick={() => setTool('line')} className={`p-2 rounded-lg transition-all ${tool === 'line' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="Line">
            <Minus className="w-4 h-4" />
        </button>
        <button onClick={() => setTool('arrow')} className={`p-2 rounded-lg transition-all ${tool === 'arrow' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="Arrow">
            <ArrowRight className="w-4 h-4" />
        </button>
        <button onClick={() => setTool('rectangle')} className={`p-2 rounded-lg transition-all ${tool === 'rectangle' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="Rectangle">
            <Square className="w-4 h-4" />
        </button>
        <button onClick={() => setTool('circle')} className={`p-2 rounded-lg transition-all ${tool === 'circle' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="Circle">
            <Circle className="w-4 h-4" />
        </button>
        <button onClick={() => setTool('text')} className={`p-2 rounded-lg transition-all ${tool === 'text' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} title="Text">
            <Type className="w-4 h-4" />
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
        <button onClick={handleUndo} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title="Undo (Ctrl+Z)" disabled={undoCount === 0}>
            <Undo className={`w-4 h-4 ${undoCount === 0 ? 'opacity-30' : ''}`} />
        </button>
        <button onClick={handleRedo} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200" title="Redo (Ctrl+Shift+Z)" disabled={redoCount === 0}>
            <Undo className={`w-4 h-4 rotate-180 ${redoCount === 0 ? 'opacity-30' : ''}`} />
        </button>
        <button onClick={clearCanvas} className="p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-rose-100 hover:text-rose-600" title="Clear">
            <Minus className="w-4 h-4" />
        </button>
        
        <div className="w-px h-6 bg-slate-300"></div>
        
        <button 
          onClick={() => setShowGrid(!showGrid)} 
          className={`p-2 rounded-lg transition-all ${showGrid ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} 
          title="Toggle Grid"
        >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
        </button>
      </div>
    </div>
  );
};

Whiteboard.displayName = 'Whiteboard';
