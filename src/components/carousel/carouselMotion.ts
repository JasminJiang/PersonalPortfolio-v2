export const CAROUSEL_WHEEL_ROTATION_FACTOR = 0.0012;
export const CAROUSEL_WHEEL_MAX_DELTA_PER_FRAME = 120;
export const CAROUSEL_TARGET_LEAD_STEPS = 0.8;

export interface CarouselWheelMotionDetail {
  delta: number;
}

export interface CarouselNavigationCommand {
  id: number;
  index: number;
}

interface WheelDeltaInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  lineHeight: number;
  pageHeight: number;
}

interface WheelMotionTargetInput {
  current: number;
  target: number;
  delta: number;
  step: number;
  lastDirection: number;
}

type WheelMotionListener = (detail: CarouselWheelMotionDetail) => void;

const wheelMotionListeners = new Set<WheelMotionListener>();
let queuedWheelDelta = 0;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeWheelDelta({
  deltaX,
  deltaY,
  deltaMode,
  lineHeight,
  pageHeight,
}: WheelDeltaInput) {
  const dominantDelta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
  const modeScale = deltaMode === 1
    ? Math.max(1, lineHeight)
    : deltaMode === 2
      ? Math.max(1, pageHeight)
      : 1;

  return dominantDelta * modeScale;
}

export function accumulateWheelSteps(accumulator: number, delta: number, threshold: number) {
  if (!Number.isFinite(delta) || delta === 0 || threshold <= 0) {
    return { steps: 0, remainder: accumulator };
  }

  const direction = Math.sign(delta);
  const nextAccumulator = accumulator !== 0 && Math.sign(accumulator) !== direction
    ? delta
    : accumulator + delta;
  const rawSteps = Math.trunc(nextAccumulator / threshold);
  const steps = rawSteps === 0 ? 0 : rawSteps;

  return {
    steps,
    remainder: nextAccumulator - steps * threshold,
  };
}

export function nextWheelMotionTarget({
  current,
  target,
  delta,
  step,
  lastDirection,
}: WheelMotionTargetInput) {
  const direction = Math.sign(delta);
  if (direction === 0) return { target, direction: lastDirection };

  const residualDirection = Math.sign(target - current);
  const baseTarget = lastDirection !== 0
    && direction !== lastDirection
    && residualDirection === lastDirection
    ? current
    : target;
  const maximumTargetLead = Math.max(step, 0) * CAROUSEL_TARGET_LEAD_STEPS;
  const requestedTarget = baseTarget + delta * CAROUSEL_WHEEL_ROTATION_FACTOR;

  return {
    target: clamp(requestedTarget, current - maximumTargetLead, current + maximumTargetLead),
    direction,
  };
}

export function publishCarouselWheelMotion(delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return;
  const normalizedDelta = clamp(
    delta,
    -CAROUSEL_WHEEL_MAX_DELTA_PER_FRAME,
    CAROUSEL_WHEEL_MAX_DELTA_PER_FRAME,
  );

  if (wheelMotionListeners.size === 0) {
    queuedWheelDelta = clamp(
      queuedWheelDelta + normalizedDelta,
      -CAROUSEL_WHEEL_MAX_DELTA_PER_FRAME,
      CAROUSEL_WHEEL_MAX_DELTA_PER_FRAME,
    );
    return;
  }

  wheelMotionListeners.forEach((listener) => listener({ delta: normalizedDelta }));
}

export function subscribeCarouselWheelMotion(listener: WheelMotionListener) {
  wheelMotionListeners.add(listener);
  if (queuedWheelDelta !== 0) {
    const delta = queuedWheelDelta;
    queuedWheelDelta = 0;
    listener({ delta });
  }

  return () => {
    wheelMotionListeners.delete(listener);
  };
}
