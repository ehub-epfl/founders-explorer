import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCompassEntries } from '../api/courses_api';
import './Compass.css';

const SEGMENT_COUNT = 64; // reduce number of bars
const LABEL_DISC_INSET_RATIO = 0.08;
const DEFAULT_STAGE_DIAMETER = 640;
const LABEL_EDGE_PADDING = 24;
const LABEL_RIGHT_MARGIN = 10;
const DEFAULT_LABEL_LENGTH = 60;
const MASK_RADIUS = 160;
const CURSOR_MOVE_PX_THRESHOLD = 3;

const CATEGORY_COLORS = ['#FF006F', '#FFBCD9', '#6D4B9A', '#4A62FF', '#5AB7D4'];

function getCategoryColor(category) {
  const normalized = (category || '').trim();
  if (!normalized) {
    return CATEGORY_COLORS[0];
  }
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  const index = hash % CATEGORY_COLORS.length;
  return CATEGORY_COLORS[index];
}

function normalizeAngle(angle) {
  return (angle + 360) % 360;
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
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [entriesBySlot, setEntriesBySlot] = useState(() => Array(SEGMENT_COUNT).fill(null));
  const discRef = useRef(null);
  const [discRadiusPx, setDiscRadiusPx] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0, active: true });
  const [cursorInitialized, setCursorInitialized] = useState(false);
  const labelLengthsRef = useRef(Array(SEGMENT_COUNT).fill(DEFAULT_LABEL_LENGTH));
  const labelNodesRef = useRef(Array(SEGMENT_COUNT).fill(null));
  const [, bumpLabelMeasurements] = useState(0);
  const pointerTargetRef = useRef({ angle: 0, distance: 1.2, distancePx: 0, active: false });
  const rafRef = useRef(null);

  const segments = useMemo(() => (
    Array.from({ length: SEGMENT_COUNT }, (_, slotIndex) => ({
      slotIndex,
      angle: (slotIndex / SEGMENT_COUNT) * 360,
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


  useEffect(() => () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (cursorInitialized) return;
    if (!stageSize.w || !stageSize.h) return;
    const stageMin = Math.min(stageSize.w, stageSize.h);
    const stageRadiusPx = stageMin / 2;
    const ringFactor = Math.max(0.2, 1 - LABEL_DISC_INSET_RATIO * 2);
    const fallbackRadius = stageRadiusPx * ringFactor;
    const radius = discRadiusPx || fallbackRadius;
    const offset = Math.max(0, radius - LABEL_RIGHT_MARGIN);
    setCursorPos({
      x: stageSize.w / 2 + offset,
      y: stageSize.h / 2,
      active: true,
    });
  }, [stageSize.w, stageSize.h, discRadiusPx, cursorInitialized]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    let rafId = null;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.height) {
        setStageSize({ w: rect.width, h: rect.height });
      }
    };

    const scheduleUpdate = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateSize();
      });
    };

    updateSize();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(scheduleUpdate);
      observer.observe(node);
      return () => {
        observer.disconnect();
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
      };
    }
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  useEffect(() => {
    const node = discRef.current;
    if (!node) return;
    setDiscRadiusPx(node.offsetWidth / 2);
  }, [stageSize.w, stageSize.h]);

  const recordLabelLength = useCallback((index, node) => {
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const length = rect.height;
    if (!Number.isFinite(length) || length <= 0) return;
    const prev = labelLengthsRef.current[index] || 0;
    if (Math.abs(prev - length) > 0.5) {
      labelLengthsRef.current[index] = length;
      bumpLabelMeasurements((v) => v + 1);
    }
  }, [bumpLabelMeasurements]);

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
      if (pointerNeedsAnotherFrame) {
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
    const ringFactor = Math.max(0.2, 1 - LABEL_DISC_INSET_RATIO * 2);
    const fallbackDiscRadius = (Math.min(rect.width, rect.height) / 2) * ringFactor;
    const discRadiusLimit = discRadiusPx || fallbackDiscRadius;
    const insideDisc = rawDistance <= discRadiusLimit;
    const dxCursor = point.x - cursorPos.x;
    const dyCursor = point.y - cursorPos.y;
    const cursorMoveDistance = Math.hypot(dxCursor, dyCursor);
    if (cursorMoveDistance > CURSOR_MOVE_PX_THRESHOLD || insideDisc !== cursorPos.active) {
      setCursorPos({ x: point.x, y: point.y, active: insideDisc });
    }
    if (!cursorInitialized) {
      setCursorInitialized(true);
    }
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
    setCursorPos((prev) => (prev.active ? { ...prev, active: false } : prev));
    scheduleAnimationFrame();
  };

  const isEnergized = pointer.distance < 1.02;

  const measuredDiameter = stageSize.w && stageSize.h
    ? Math.min(stageSize.w, stageSize.h)
    : DEFAULT_STAGE_DIAMETER;
  const stageRadius = measuredDiameter / 2;
  const ringFactor = Math.max(0.2, 1 - LABEL_DISC_INSET_RATIO * 2);
  const fallbackDiscRadius = stageRadius * ringFactor;
  const effectiveDiscRadius = discRadiusPx || fallbackDiscRadius;
  const outerRadiusBase = Math.max(0, Math.min(stageRadius - LABEL_EDGE_PADDING, effectiveDiscRadius));
  const usableOuterRadius = Math.max(0, outerRadiusBase - LABEL_RIGHT_MARGIN);
  const stageMinDimension = stageSize.w && stageSize.h
    ? Math.min(stageSize.w, stageSize.h)
    : DEFAULT_STAGE_DIAMETER;
  const discInsetPx = stageMinDimension * LABEL_DISC_INSET_RATIO;
  const maskExtent = Math.max(0, stageMinDimension - 2 * discInsetPx);
  const maskX = Math.max(0, Math.min(maskExtent, cursorPos.x - discInsetPx));
  const maskY = Math.max(0, Math.min(maskExtent, cursorPos.y - discInsetPx));

  return (
    <div className="compass-page">
      <div
        ref={containerRef}
        className="compass-stage"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={{
          '--mask-x': `${maskX}px`,
          '--mask-y': `${maskY}px`,
          '--mask-radius': `${MASK_RADIUS}px`,
        }}
      >
        <div className="compass-viewport">
          <div className="compass-grid" />
          <div ref={discRef} className="compass-disc" />
          {segments.map(({ slotIndex, angle }) => {
            const entry = entriesBySlot[slotIndex];
            const category = entry?.category || '';
            const label = (entry?.label || '').trim();
            if (!label) {
              return null;
          }
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
          const transformStyle = {
            transform: `translate(-50%, -50%) rotate(${angle}deg)`,
          };
          const labelLength = labelLengthsRef.current[slotIndex] || DEFAULT_LABEL_LENGTH;
          const distanceFromCenter = Math.max(0, usableOuterRadius - labelLength);
          const stackStyle = {
            transform: `translate(-50%, -${distanceFromCenter}px)`,
          };
            return (
              <div
                key={slotIndex}
                className="compass-label"
                data-category={category || undefined}
                data-energized={isEnergized}
                style={transformStyle}
              >
                <div
                  className="compass-label-stack"
                  style={stackStyle}
                  data-category={category || undefined}
                >
                  <span
                    className="compass-label-chip"
                    data-energized={isEnergized}
                    data-category={category || undefined}
                    title={entryTitle || undefined}
                    role={isInteractive ? 'button' : undefined}
                    tabIndex={isInteractive ? 0 : -1}
                    aria-label={entryTitle || label || undefined}
                    onClick={navigateToCourse}
                    onKeyDown={handleKeyDown}
                    style={{
                      cursor: isInteractive ? 'pointer' : 'default',
                      '--chip-bg': getCategoryColor(category),
                    }}
                  >
                    {label}
                  </span>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="compass-explore-button"
            onClick={() => navigate('/guided')}
          >
            Explore All
          </button>
        </div>
        <div className="compass-mask" />
      </div>
      <div className="compass-measurements" aria-hidden="true">
        {entriesBySlot.map((entry, slotIndex) => {
          const label = (entry?.label || '').trim();
          if (!label) {
            labelNodesRef.current[slotIndex] = null;
            return null;
          }
          const category = entry?.category || '';
          const setRef = (node) => {
            labelNodesRef.current[slotIndex] = node;
            if (node) {
              recordLabelLength(slotIndex, node);
            }
          };
          return (
            <div key={`measure-${slotIndex}`} ref={setRef} className="compass-measure-stack">
              <span
                className="compass-label-chip"
                data-category={category || undefined}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Compass;
