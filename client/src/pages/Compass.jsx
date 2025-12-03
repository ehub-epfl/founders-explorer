import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

const POINTER_SMOOTHING = 0.18;
const MAX_DISTANCE = 1.3;
const MIN_ANGLE_DELTA = 0.8;
const MIN_DISTANCE_DELTA = 0.01;
const ANGLE_SNAP_DEGREES = 1.5;

function shortestAngleDelta(target, current) {
  let delta = target - current;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function Compass() {
  const containerRef = useRef(null);
  const navigate = useNavigate();
  const [pointer, setPointer] = useState({ angle: 0, distance: 1.2, distancePx: 0, active: false });
  const [trace, setTrace] = useState([]);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [entriesBySlot, setEntriesBySlot] = useState(() => Array(SEGMENT_COUNT).fill(null));
  const pointerTargetRef = useRef({ angle: 0, distance: 1.2, distancePx: 0, active: false });
  const pendingTraceRef = useRef(null);
  const traceRef = useRef([]);
  const rafRef = useRef(null);

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
              description: typeof row.description === 'string' ? row.description : '',
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

  useEffect(() => {
    traceRef.current = trace;
  }, [trace]);

  useEffect(() => () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const scheduleAnimationFrame = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    const tick = () => {
      rafRef.current = null;
      let pointerNeedsAnotherFrame = false;
      setPointer((prev) => {
        const target = pointerTargetRef.current || prev;
        const angleDelta = shortestAngleDelta(target.angle, prev.angle);
        const next = {
          angle: prev.angle + angleDelta * POINTER_SMOOTHING,
          distance: prev.distance + (target.distance - prev.distance) * POINTER_SMOOTHING,
          distancePx: prev.distancePx + (target.distancePx - prev.distancePx) * POINTER_SMOOTHING,
          active: target.active,
        };
        const angleClose = Math.abs(angleDelta) < 0.05;
        const distanceClose = Math.abs(target.distance - next.distance) < 0.01;
        const distancePxClose = Math.abs(target.distancePx - next.distancePx) < 1;
        if (!angleClose || !distanceClose || !distancePxClose) {
          pointerNeedsAnotherFrame = true;
        } else {
          next.angle = target.angle;
          next.distance = target.distance;
          next.distancePx = target.distancePx;
        }
        return next;
      });
      if (pendingTraceRef.current) {
        setTrace(pendingTraceRef.current);
        pendingTraceRef.current = null;
      }
      if (pointerNeedsAnotherFrame || pendingTraceRef.current) {
        scheduleAnimationFrame();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
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
    const distance = Math.min(MAX_DISTANCE, rawDistance / maxRadius);
    setStageSize({ w: rect.width, h: rect.height });
    const last = pointerTargetRef.current;
    const angleDiff = Math.abs(shortestAngleDelta(angle, last.angle));
    const distanceDiff = Math.abs(distance - last.distance);
    if (angleDiff < MIN_ANGLE_DELTA && distanceDiff < MIN_DISTANCE_DELTA) {
      return;
    }
    const snappedAngle = Math.round(angle / ANGLE_SNAP_DEGREES) * ANGLE_SNAP_DEGREES;
    pointerTargetRef.current = {
      angle: normalizeAngle(snappedAngle),
      distance,
      distancePx: rawDistance,
      active: true,
    };
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const prevTrace = traceRef.current || [];
    const nextTrace = [...prevTrace, point];
    const overflow = nextTrace.length - 140;
    pendingTraceRef.current = overflow > 0 ? nextTrace.slice(overflow) : nextTrace;
    scheduleAnimationFrame();
  };

  const handleLeave = () => {
    const currentAngle = pointerTargetRef.current.angle;
    pointerTargetRef.current = {
      angle: currentAngle,
      distance: MAX_DISTANCE,
      distancePx: 0,
      active: false,
    };
    pendingTraceRef.current = [];
    scheduleAnimationFrame();
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
          const label = (entry?.label || '').trim();
          const description = (entry?.description || '').trim();
          const isCourse = category === 'course';
          const entryTitle = isCourse && description && label
            ? `${description} (${label})`
            : (description || label || undefined);
          const isInteractive = isCourse && label;
          const navigateToCourse = (event) => {
            if (!isInteractive) return;
            event.preventDefault();
            event.stopPropagation();
            const slug = label;
            if (!slug) return;
            const params = new URLSearchParams();
            params.set('focus', slug);
            navigate(`/courses?${params.toString()}`);
          };
          const handleKeyDown = (event) => {
            if (!isInteractive) return;
            if (event.key === 'Enter' || event.key === ' ') {
              navigateToCourse(event);
            }
          };
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
                data-label={label || undefined}
                title={entryTitle || undefined}
                role={isInteractive ? 'button' : undefined}
                tabIndex={isInteractive ? 0 : -1}
                aria-label={entryTitle || label || undefined}
                onClick={navigateToCourse}
                onKeyDown={handleKeyDown}
                style={{
                  // All bars have equal length
                  height: `${BAR_LENGTH}px`,
                  // Position bar so base sits at baseRadius and extends outward by BAR_LENGTH
                  transform: `translate(-50%, -${barCenterRadius}px)`,
                  cursor: isInteractive ? 'pointer' : 'default',
                }}
              />
            </div>
          );
        })}
        <div
          className="compass-core"
          style={{ background: '#ffffff' }}  // make central disc solid and render above bars
        />
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
