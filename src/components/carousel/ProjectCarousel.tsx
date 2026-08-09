import {
  Component,
  type ErrorInfo,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface CarouselProject {
  slug: string;
  order: number;
  title: string;
  categoryLabel: string;
  year: number;
  coverSrc: string;
}

interface Props {
  projects: CarouselProject[];
}

const DRAG_STEP_PX = 56;
const AUTOMATIC_SCENE_DELAY_MS = 12_000;
const LazyCarouselScene = lazy(() => import("./ProjectCarouselScene"));

class CarouselErrorBoundary extends Component<{
  children: ReactNode;
  onError: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

function projectIndexFromHash(projects: CarouselProject[]) {
  const slug = window.location.hash.slice(1);
  const index = projects.findIndex((project) => project.slug === slug);
  return index >= 0 ? index : 0;
}

export default function ProjectCarousel({ projects }: Props) {
  const [renderState, setRenderState] = useState<"checking" | "loading" | "ready" | "fallback">("checking");
  const [sceneEnabled, setSceneEnabled] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const shell = useRef<HTMLElement>(null);
  const activeIndexRef = useRef(0);
  const sceneRequested = useRef(false);
  const suppressPanelSelectUntil = useRef(0);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    stepX: number;
    moved: boolean;
  } | null>(null);
  const activeProject = projects[activeIndex] ?? projects[0];
  const previousProject = projects[(activeIndex - 1 + projects.length) % projects.length];
  const nextProject = projects[(activeIndex + 1) % projects.length];

  const requestScene = useCallback(() => {
    if (sceneRequested.current) return;
    sceneRequested.current = true;
    setSceneEnabled(true);
  }, []);

  useEffect(() => {
    let automaticSceneTimer: number | undefined;
    const setupFrame = window.requestAnimationFrame(() => {
      const initialIndex = projectIndexFromHash(projects);
      activeIndexRef.current = initialIndex;
      setActiveIndex(initialIndex);
      if (!supportsWebGL()) {
        setRenderState("fallback");
        return;
      }
      setRenderState("ready");

      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!connection?.saveData && !reduceMotion) {
        automaticSceneTimer = window.setTimeout(requestScene, AUTOMATIC_SCENE_DELAY_MS);
      }
    });

    return () => {
      window.cancelAnimationFrame(setupFrame);
      if (automaticSceneTimer !== undefined) window.clearTimeout(automaticSceneTimer);
      document.documentElement.removeAttribute("data-carousel-state");
    };
  }, [projects, requestScene]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(preference.matches);
    syncPreference();
    preference.addEventListener("change", syncPreference);
    return () => preference.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.carouselState = renderState;
  }, [renderState]);

  const activateProject = useCallback((requestedIndex: number) => {
    if (projects.length === 0) return;
    const index = (requestedIndex + projects.length) % projects.length;
    const project = projects[index];
    if (!project) return;
    activeIndexRef.current = index;
    setActiveIndex(index);
    history.replaceState(history.state, "", `/#${project.slug}`);
  }, [projects]);

  const moveBy = useCallback((distance: number) => {
    requestScene();
    activateProject(activeIndexRef.current + distance);
  }, [activateProject, requestScene]);

  const selectPanel = useCallback((index: number) => {
    if (performance.now() < suppressPanelSelectUntil.current) return;
    activateProject(index);
  }, [activateProject]);

  useEffect(() => {
    const element = shell.current;
    if (!element || renderState === "checking" || renderState === "fallback") return;

    let accumulatedDelta = 0;
    let locked = false;
    let unlockTimer: number | undefined;
    const handleWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      event.preventDefault();
      accumulatedDelta += delta;
      if (locked || Math.abs(accumulatedDelta) < 28) return;
      moveBy(accumulatedDelta > 0 ? 1 : -1);
      accumulatedDelta = 0;
      locked = true;
      unlockTimer = window.setTimeout(() => {
        locked = false;
      }, reducedMotion ? 80 : 180);
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", handleWheel);
      if (unlockTimer !== undefined) window.clearTimeout(unlockTimer);
    };
  }, [moveBy, reducedMotion, renderState]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("a, button")) return;
    requestScene();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      stepX: event.clientX,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    const totalDistance = event.clientX - currentDrag.startX;
    const stepDistance = event.clientX - currentDrag.stepX;
    if (Math.abs(totalDistance) < 8) return;
    event.currentTarget.dataset.dragging = "true";
    suppressPanelSelectUntil.current = performance.now() + 250;
    if (Math.abs(stepDistance) < DRAG_STEP_PX) return;
    moveBy(stepDistance < 0 ? 1 : -1);
    currentDrag.stepX = event.clientX;
    currentDrag.moved = true;
  };

  const endPointerGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    const totalDistance = event.clientX - currentDrag.startX;
    if (!currentDrag.moved && Math.abs(totalDistance) >= 32) {
      moveBy(totalDistance < 0 ? 1 : -1);
    }
    if (Math.abs(totalDistance) >= 8) {
      suppressPanelSelectUntil.current = performance.now() + 250;
    }
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => moveBy(-1),
      ArrowUp: () => moveBy(-1),
      ArrowRight: () => moveBy(1),
      ArrowDown: () => moveBy(1),
      Home: () => activateProject(0),
      End: () => activateProject(projects.length - 1),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const useStaticFallback = useCallback(() => {
    setSceneReady(false);
    setSceneEnabled(false);
  }, []);
  const markSceneReady = useCallback(() => setSceneReady(true), []);

  if (!activeProject || renderState === "fallback") return null;

  return (
    <section
      ref={shell}
      className="carousel-shell"
      data-state={renderState}
      data-scene-state={sceneReady ? "ready" : sceneEnabled ? "loading" : "deferred"}
      aria-label="Interactive project carousel"
      aria-roledescription="carousel"
      aria-describedby="carousel-instructions"
      tabIndex={renderState === "checking" ? -1 : 0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointerGesture}
      onPointerCancel={endPointerGesture}
    >
      <div className="carousel-shell__static" aria-hidden="true">
        {[previousProject ?? activeProject, activeProject, nextProject ?? activeProject].map((project, previewIndex) => (
          <figure
            className={`carousel-shell__static-panel carousel-shell__static-panel--${["previous", "active", "next"][previewIndex]}`}
            key={`${project.slug}-${previewIndex}`}
          >
            <img
              src={project.coverSrc}
              alt=""
              loading={previewIndex === 1 ? "eager" : "lazy"}
              fetchPriority={previewIndex === 1 ? "high" : "low"}
              decoding="async"
              draggable={false}
            />
          </figure>
        ))}
      </div>

      <div className="carousel-shell__canvas" aria-hidden="true">
        {sceneEnabled && (
          <CarouselErrorBoundary onError={useStaticFallback}>
            <Suspense fallback={null}>
              <LazyCarouselScene
                projects={projects}
                activeIndex={activeIndex}
                reducedMotion={reducedMotion}
                onSelect={selectPanel}
                onReady={markSceneReady}
                onContextLost={useStaticFallback}
              />
            </Suspense>
          </CarouselErrorBoundary>
        )}
      </div>

      <div className="carousel-shell__status" aria-live="polite" aria-atomic="true">
        <p>
          <span>{String(activeProject.order).padStart(2, "0")} / {String(projects.length).padStart(2, "0")}</span>
          <span>{activeProject.categoryLabel} · {activeProject.year}</span>
        </p>
        <h1>{activeProject.title}</h1>
        <a href={`/projects/${activeProject.slug}/`}>View project</a>
      </div>

      <div className="carousel-shell__controls" role="group" aria-label="Carousel controls">
        <button
          type="button"
          onClick={() => moveBy(-1)}
          aria-label={`Previous project: ${previousProject?.title ?? "previous"}`}
        >
          <span aria-hidden="true">←</span>
          <span>Previous</span>
        </button>
        <button
          type="button"
          onClick={() => moveBy(1)}
          aria-label={`Next project: ${nextProject?.title ?? "next"}`}
        >
          <span>Next</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <p className="carousel-shell__hint" id="carousel-instructions">
        Wheel, drag, swipe or use arrow keys
      </p>
    </section>
  );
}
