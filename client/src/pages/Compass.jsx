import { useEffect, useMemo, useRef, useState } from 'react';
import { getCompassEntries } from '../api/courses_api';
import './Compass.css';

const SEGMENT_COUNT = 64; // reduce number of bars
const DISC_RADIUS = 120;
const BAR_LENGTH = 140; // bar length increased (can be adjusted for visual effect)

function normalizeAngle(angle) {
  return (angle + 360) % 360;
}

function angularDifference(a, b) {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return diff > 180 ? 360 - diff : diff;
}

function Compass() {
  const containerRef = useRef(null);
  const [pointer, setPointer] = useState({ angle: 0, distance: 1.2, distancePx: 0, active: false });
  const [trace, setTrace] = useState([]);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [entriesBySlot, setEntriesBySlot] = useState(() => Array(SEGMENT_COUNT).fill(null));

  const segments = useMemo(() => (
    Array.from({ length: SEGMENT_COUNT }, (_, index) => ({
      id: index,
      angle: (index / SEGMENT_COUNT) * 360,
      wobble: Math.sin(index * 0.38) * 8 + Math.cos(index * 0.16) * 5,
    }))
  ), []);

  useEffect(() => {
    let cancelled = false;

    async function loadEntries() {
      try {
        const rows = await getCompassEntries();
        if (!Array.isArray(rows)) return;
        const slots = Array(SEGMENT_COUNT).fill(null);
        for (const row of rows) {
          const idx = Number(row?.slot_index);
          if (Number.isInteger(idx) && idx >= 0 && idx < SEGMENT_COUNT) {
            slots[idx] = {
              label: typeof row.label === 'string' ? row.label : '',
              url: typeof row.url === 'string' ? row.url : '',
              category: typeof row.category === 'string' ? row.category : '',
            };
          }
        }
        if (!cancelled) {
          setEntriesBySlot(slots);
        }
      } catch (err) {
        // Non-fatal: Compass can still render without data
        // eslint-disable-next-line no-console
        console.warn('Failed to load compass entries', err);
      }
    }

    loadEntries();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMove = (event) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Rotate by +90deg so that 0deg corresponds to "up" in CSS, matching the pointer's default orientation
    const angle = normalizeAngle(rawAngle + 90);
    const maxRadius = Math.min(rect.width, rect.height) / 2;
    const rawDistance = Math.hypot(dx, dy);
    const distance = rawDistance / maxRadius;
    setStageSize({ w: rect.width, h: rect.height });
    setPointer({ angle, distance, distancePx: rawDistance, active: true });
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setTrace((prev) => {
      const next = [...prev, point];
      const overflow = next.length - 140;
      return overflow > 0 ? next.slice(overflow) : next;
    });
  };

  const handleLeave = () => {
    setPointer((prev) => ({ ...prev, distance: 1.3, distancePx: 0, active: false }));
    setTrace([]);
  };

  const computeOffset = (segment) => {
    // Bell-shaped function: symmetric around pointer.angle
    const angleDiff = angularDifference(segment.angle, pointer.angle);

    // Controls width of bell curve (degrees): smaller = sharper, larger = smoother
    const sigma = 80; // widen bell curve so more bars are visible

    // Standard Gaussian: baseRadius(0) = DISC_RADIUS
    const t = angleDiff / sigma;
    const baseRadius = DISC_RADIUS * Math.exp(-0.5 * t * t);

    // baseRadius represents distance of bar base from center (excludes bar height), max = disc radius
    return baseRadius;
  };

  const isEnergized = pointer.distance < 1.02;

  const lineLength = pointer.active ? pointer.distancePx : 0;
  const tracePoints = trace.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="compass-page">
      <div
        ref={containerRef}
        className="compass-stage"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {trace.length > 1 && (
          <svg
            className="compass-trace"
            width={stageSize.w || undefined}
            height={stageSize.h || undefined}
            viewBox={stageSize.w && stageSize.h ? `0 0 ${stageSize.w} ${stageSize.h}` : undefined}
          >
            <polyline points={tracePoints} />
          </svg>
        )}
        <div className="compass-grid" />
        {segments.map((segment) => {
          const entry = entriesBySlot[segment.id] || null;
          const category = entry?.category || '';
          // Bell function output: bar base radius, max = DISC_RADIUS
          const baseRadius = computeOffset(segment);
          // Bar center distance = base radius + half of bar length
          const barCenterRadius = baseRadius + BAR_LENGTH / 2;
          return (
            <div
              key={segment.id}
              className="compass-bar"
              style={{ transform: `translate(-50%, -50%) rotate(${segment.angle}deg)` }}
            >
              <span
                data-energized={isEnergized}
                data-category={category || undefined}
                title={entry?.label || undefined}
                style={{
                  // All bars have equal length
                  height: `${BAR_LENGTH}px`,
                  // Position bar so base sits at baseRadius and extends outward by BAR_LENGTH
                  transform: `translate(-50%, -${barCenterRadius}px)`,
                }}
              />
            </div>
          );
        })}
        <div
          className="compass-core"
          style={{ background: '#ffffff' }}  // make central disc solid and render above bars
        />
        <div
          className="compass-pointer"
          style={{
            transform: `translate(-50%, -50%) rotate(${pointer.angle}deg)`,
            opacity: pointer.active ? 1 : 0,
          }}
        >
          <span style={{ height: `${lineLength}px` }} />
        </div>
      </div>
      <div className="compass-hero">
        <h1>Compass</h1>
        <p>Move your cursor near the disc — the columns react and stretch outward from the rim.</p>
      </div>
      <div className="compass-legend">
        <span className="pulse" />
        <span>Columns stretch toward your cursor and settle back when you leave. The red ray follows your pointer.</span>
      </div>
    </div>
  );
}

export default Compass;
