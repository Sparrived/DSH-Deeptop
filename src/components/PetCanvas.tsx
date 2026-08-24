import { useEffect, useRef, useState } from "react";
import type { PetAnimationState } from "../lib/desktop";
import {
  DEEPTOP_PET_CELL,
  petAnimationDurationMs,
  petAnimationSpecs,
  petFrameColumn,
  petLookCell,
} from "../app/pet-model";

interface PetCanvasProps {
  state: PetAnimationState;
  source: string;
  lookDirection: number | null;
  motionEnabled: boolean;
  onReadyChange: (ready: boolean) => void;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

/** 直接从 Deeptop Pet 的 8×11 图集绘制，不把逐帧更新放进 React 状态树。 */
export function PetCanvas({ state, source, lookDirection, motionEnabled, onReadyChange }: PetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageRevision, setImageRevision] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    imageRef.current = null;
    onReadyChange(false);
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setImageRevision((revision) => revision + 1);
      onReadyChange(true);
    };
    image.onerror = () => {
      if (!cancelled) onReadyChange(false);
    };
    image.src = source;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
      if (imageRef.current === image) imageRef.current = null;
    };
  }, [onReadyChange, source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const drawingCanvas = canvas;
    const drawingImage = image;
    const drawingContext = context;
    const spec = petAnimationSpecs[state];
    let cancelled = false;
    let animationFrame = 0;
    let lastCell = "";

    drawingCanvas.width = DEEPTOP_PET_CELL.width;
    drawingCanvas.height = DEEPTOP_PET_CELL.height;

    function draw(row: number, column: number) {
      const cell = `${row}:${column}`;
      if (cell === lastCell) return;
      lastCell = cell;
      drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      drawingContext.imageSmoothingEnabled = true;
      drawingContext.drawImage(
        drawingImage,
        column * DEEPTOP_PET_CELL.width,
        row * DEEPTOP_PET_CELL.height,
        DEEPTOP_PET_CELL.width,
        DEEPTOP_PET_CELL.height,
        0,
        0,
        drawingCanvas.width,
        drawingCanvas.height,
      );
    }

    if (lookDirection !== null) {
      const cell = petLookCell(lookDirection);
      draw(cell.row, cell.column);
      return;
    }

    draw(spec.row, 0);
    if (!motionEnabled || reducedMotion || spec.frameDurationsMs.length <= 1) return;

    const duration = petAnimationDurationMs(state);
    let startedAt = 0;
    function animate(timestamp: number) {
      if (cancelled) return;
      if (startedAt === 0) startedAt = timestamp;
      const elapsed = timestamp - startedAt;
      draw(spec.row, petFrameColumn(state, elapsed));
      if (spec.loop || elapsed < duration) animationFrame = requestAnimationFrame(animate);
    }
    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
    };
  }, [imageRevision, lookDirection, motionEnabled, reducedMotion, state]);

  return <canvas ref={canvasRef} className="pet-sprite-canvas" aria-hidden="true" />;
}
