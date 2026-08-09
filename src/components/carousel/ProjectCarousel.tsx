import {
  Component,
  type ErrorInfo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { navigate } from "astro:transitions/client";
import {
  accumulateWheelSteps,
  CAROUSEL_WHEEL_MAX_DELTA_PER_FRAME,
  type CarouselNavigationCommand,
  normalizeWheelDelta,
  publishCarouselWheelMotion,
} from "./carouselMotion";

export interface CarouselProject {
  slug: string;
  order: number;
  title: string;
  category: "architecture" | "immersive-media" | "ui-ux" | "photography";
  categoryLabel: string;
  year: number;
  coverSrc: string;
  previewSrc: string;
  compactSrc: string;
}

interface Props {
  projects: CarouselProject[];
}

const DRAG_STEP_PX = 56;
const STATIC_WHEEL_STEP_PX = 96;
const REDUCED_MOTION_WHEEL_INTERVAL_MS = 180;
const SCENE_AFTER_INPUT_DELAY_MS = 220;
const AUTOMATIC_SCENE_IDLE_TIMEOUT_MS = 2500;
const LazyCarouselScene = lazy(() => import("./ProjectCarouselScene"));
const FILTERS = [
  { id: "all", label: "All projects" },
  { id: "architecture", label: "Architecture design" },
  { id: "immersive-media", label: "MR" },
  { id: "ui-ux", label: "UIUX" },
  { id: "photography", label: "Photography" },
] as const;
type ProjectFilter = (typeof FILTERS)[number]["id"];

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
  const [sceneHasTexture, setSceneHasTexture] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [openingIndex, setOpeningIndex] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [compactTextures, setCompactTextures] = useState(false);
  const [navigationCommand, setNavigationCommand] = useState<CarouselNavigationCommand>({ id: 0, index: 0 });
  const shell = useRef<HTMLElement>(null);
  const activeIndexRef = useRef(0);
  const navigationCommandId = useRef(0);
  const sceneRequested = useRef(false);
  const automaticSceneHandle = useRef<{ kind: "idle" | "timer"; id: number } | null>(null);
  const sceneUpgradeTimer = useRef<number | undefined>(undefined);
  const staticWheelAccumulator = useRef(0);
  const openingTimer = useRef<number | undefined>(undefined);
  const suppressPanelSelectUntil = useRef(0);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    stepX: number;
    moved: boolean;
  } | null>(null);
  const filteredProjects = useMemo(
    () => filter === "all" ? projects : projects.filter((project) => project.category === filter),
    [filter, projects],
  );
  const activeProject = filteredProjects[activeIndex] ?? filteredProjects[0] ?? projects[0];
  const previousProject = filteredProjects[(activeIndex - 1 + filteredProjects.length) % filteredProjects.length];
  const nextProject = filteredProjects[(activeIndex + 1) % filteredProjects.length];

  const cancelAutomaticScene = useCallback(() => {
    const handle = automaticSceneHandle.current;
    if (!handle) return;
    if (handle.kind === "idle") window.cancelIdleCallback(handle.id);
    else window.clearTimeout(handle.id);
    automaticSceneHandle.current = null;
  }, []);

  const enableScene = useCallback(() => {
    if (sceneRequested.current) return;
    cancelAutomaticScene();
    if (sceneUpgradeTimer.current !== undefined) {
      window.clearTimeout(sceneUpgradeTimer.current);
      sceneUpgradeTimer.current = undefined;
    }
    sceneRequested.current = true;
    setSceneEnabled(true);
  }, [cancelAutomaticScene]);

  const scheduleSceneUpgrade = useCallback(() => {
    if (sceneRequested.current) return;
    cancelAutomaticScene();
    if (sceneUpgradeTimer.current !== undefined) window.clearTimeout(sceneUpgradeTimer.current);
    sceneUpgradeTimer.current = window.setTimeout(enableScene, SCENE_AFTER_INPUT_DELAY_MS);
  }, [cancelAutomaticScene, enableScene]);

  useEffect(() => {
    const setupFrame = window.requestAnimationFrame(() => {
      const initialIndex = projectIndexFromHash(projects);
      activeIndexRef.current = initialIndex;
      setActiveIndex(initialIndex);
      navigationCommandId.current += 1;
      setNavigationCommand({ id: navigationCommandId.current, index: initialIndex });
      if (!supportsWebGL()) {
        setRenderState("fallback");
        return;
      }
      setRenderState("ready");

      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
      setCompactTextures(deviceMemory <= 4 || window.innerWidth < 768);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!connection?.saveData && !reduceMotion) {
        if (typeof window.requestIdleCallback === "function") {
          const id = window.requestIdleCallback(enableScene, { timeout: AUTOMATIC_SCENE_IDLE_TIMEOUT_MS });
          automaticSceneHandle.current = { kind: "idle", id };
        } else {
          const id = window.setTimeout(enableScene, 1200);
          automaticSceneHandle.current = { kind: "timer", id };
        }
      }
    });

    return () => {
      window.cancelAnimationFrame(setupFrame);
      cancelAutomaticScene();
      if (sceneUpgradeTimer.current !== undefined) window.clearTimeout(sceneUpgradeTimer.current);
      document.documentElement.removeAttribute("data-carousel-state");
    };
  }, [cancelAutomaticScene, enableScene, projects]);

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

  const reportActiveProject = useCallback((requestedIndex: number) => {
    if (filteredProjects.length === 0) return;
    const index = (requestedIndex + filteredProjects.length) % filteredProjects.length;
    const project = filteredProjects[index];
    if (!project) return;
    if (activeIndexRef.current === index && window.location.hash === `#${project.slug}`) return;
    activeIndexRef.current = index;
    setActiveIndex(index);
    history.replaceState(history.state, "", `/#${project.slug}`);
  }, [filteredProjects]);

  const commandProject = useCallback((requestedIndex: number) => {
    if (filteredProjects.length === 0) return;
    const index = (requestedIndex + filteredProjects.length) % filteredProjects.length;
    reportActiveProject(index);
    navigationCommandId.current += 1;
    setNavigationCommand({ id: navigationCommandId.current, index });
  }, [filteredProjects.length, reportActiveProject]);

  const moveBy = useCallback((distance: number) => {
    if (openingIndex !== null) return;
    scheduleSceneUpgrade();
    commandProject(activeIndexRef.current + distance);
  }, [commandProject, openingIndex, scheduleSceneUpgrade]);

  const beginOpen = useCallback((index: number) => {
    if (openingIndex !== null) return;
    const project = filteredProjects[index];
    if (!project) return;
    commandProject(index);
    setOpeningIndex(index);
    openingTimer.current = window.setTimeout(() => {
      void navigate(`/projects/${project.slug}/`);
    }, reducedMotion ? 40 : 560);
  }, [commandProject, filteredProjects, openingIndex, reducedMotion]);

  useEffect(() => () => {
    if (openingTimer.current !== undefined) window.clearTimeout(openingTimer.current);
  }, []);

  const selectPanel = useCallback((index: number) => {
    if (performance.now() < suppressPanelSelectUntil.current) return;
    suppressPanelSelectUntil.current = performance.now() + 100;
    beginOpen(index);
  }, [beginOpen]);

  const handleCanvasClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (openingIndex !== null || performance.now() < suppressPanelSelectUntil.current) return;
    if ((event.target as HTMLElement).closest("a, button")) return;
    if (!(event.target as HTMLElement).closest(".carousel-shell__canvas")) return;
    const bounds = shell.current?.getBoundingClientRect();
    if (!bounds || filteredProjects.length === 0) return;
    const relativeY = (event.clientY - bounds.top) / bounds.height;
    if (relativeY < 0.38 || relativeY > 0.72) return;
    const relativeX = Math.min(0.999, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const visibleSlot = Math.floor(relativeX * 5);
    const offset = [-2, -1, 0, 1, 2][visibleSlot] ?? 0;
    const index = (activeIndexRef.current + offset + filteredProjects.length) % filteredProjects.length;
    beginOpen(index);
  }, [beginOpen, filteredProjects.length, openingIndex]);

  const changeFilter = useCallback((nextFilter: ProjectFilter) => {
    if (nextFilter === filter) return;
    const nextProjects = nextFilter === "all"
      ? projects
      : projects.filter((project) => project.category === nextFilter);
    const firstProject = nextProjects[0];
    activeIndexRef.current = 0;
    setActiveIndex(0);
    setFilter(nextFilter);
    if (firstProject) history.replaceState(history.state, "", `/#${firstProject.slug}`);
    navigationCommandId.current += 1;
    setNavigationCommand({ id: navigationCommandId.current, index: 0 });
    scheduleSceneUpgrade();
  }, [filter, projects, scheduleSceneUpgrade]);

  useEffect(() => {
    const element = shell.current;
    if (!element || renderState === "checking" || renderState === "fallback") return;

    const computedStyle = window.getComputedStyle(element);
    const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
    const parsedFontSize = Number.parseFloat(computedStyle.fontSize);
    const lineHeight = Number.isFinite(parsedLineHeight)
      ? parsedLineHeight
      : (Number.isFinite(parsedFontSize) ? parsedFontSize * 1.2 : 16);
    let lastReducedMotionStep = 0;
    let pendingWheelDelta = 0;
    let pendingWheelDirection = 0;
    let wheelFrame: number | undefined;

    const flushWheelMotion = () => {
      wheelFrame = undefined;
      const delta = Math.max(
        -CAROUSEL_WHEEL_MAX_DELTA_PER_FRAME,
        Math.min(CAROUSEL_WHEEL_MAX_DELTA_PER_FRAME, pendingWheelDelta),
      );
      pendingWheelDelta = 0;
      pendingWheelDirection = 0;
      if (!sceneReady) {
        const nextStep = accumulateWheelSteps(staticWheelAccumulator.current, delta, STATIC_WHEEL_STEP_PX);
        staticWheelAccumulator.current = nextStep.remainder;
        if (nextStep.steps !== 0) commandProject(activeIndexRef.current + nextStep.steps);
        scheduleSceneUpgrade();
        return;
      }
      publishCarouselWheelMotion(delta);
    };

    const handleWheel = (event: WheelEvent) => {
      if (openingIndex !== null) return;
      const delta = normalizeWheelDelta({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        lineHeight,
        pageHeight: element.clientHeight,
      });
      if (delta === 0) return;
      if (document.hidden) return;

      if (sceneReady && reducedMotion) {
        const now = performance.now();
        if (now - lastReducedMotionStep >= REDUCED_MOTION_WHEEL_INTERVAL_MS) {
          lastReducedMotionStep = now;
          moveBy(delta > 0 ? 1 : -1);
        }
        return;
      }

      const direction = Math.sign(delta);
      if (pendingWheelDirection !== 0 && direction !== pendingWheelDirection) pendingWheelDelta = 0;
      pendingWheelDirection = direction;
      pendingWheelDelta += delta;
      if (wheelFrame === undefined) wheelFrame = window.requestAnimationFrame(flushWheelMotion);
    };

    element.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      element.removeEventListener("wheel", handleWheel);
      if (wheelFrame !== undefined) window.cancelAnimationFrame(wheelFrame);
    };
  }, [commandProject, moveBy, openingIndex, reducedMotion, renderState, sceneReady, scheduleSceneUpgrade]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("a, button")) return;
    scheduleSceneUpgrade();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      stepX: event.clientX,
      moved: false,
    };
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
      Home: () => commandProject(0),
      End: () => commandProject(filteredProjects.length - 1),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const useStaticFallback = useCallback(() => {
    setSceneReady(false);
    setSceneHasTexture(false);
    setSceneEnabled(false);
  }, []);
  const markSceneReady = useCallback(() => {
    staticWheelAccumulator.current = 0;
    setSceneReady(true);
  }, []);
  const markActiveTextureReady = useCallback(() => setSceneHasTexture(true), []);

  if (!activeProject || renderState === "fallback") return null;
  const previewProjects = [-2, -1, 0, 1, 2].map((offset, previewIndex) => {
    const index = (activeIndex + offset + filteredProjects.length) % filteredProjects.length;
    return {
      index,
      position: ["previous-far", "previous", "active", "next", "next-far"][previewIndex],
      project: filteredProjects[index] ?? activeProject,
    };
  });

  return (
    <section
      ref={shell}
      className="carousel-shell"
      data-state={renderState}
      data-scene-state={sceneReady ? "ready" : sceneEnabled ? "loading" : "deferred"}
      data-texture-state={sceneHasTexture ? "ready" : "loading"}
      data-opening={openingIndex !== null ? "true" : "false"}
      aria-label="Interactive project carousel"
      aria-roledescription="carousel"
      aria-describedby="carousel-instructions"
      tabIndex={renderState === "checking" ? -1 : 0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointerGesture}
      onPointerCancel={endPointerGesture}
      onClick={handleCanvasClick}
    >
      <header className="carousel-shell__header">
        <nav className="carousel-shell__filters" aria-label="Project categories">
          {FILTERS.map((item) => {
            const count = item.id === "all"
              ? projects.length
              : projects.filter((project) => project.category === item.id).length;
            return (
              <button
                type="button"
                key={item.id}
                className={filter === item.id ? "is-active" : undefined}
                aria-pressed={filter === item.id}
                onClick={() => changeFilter(item.id)}
              >
                <span>{item.label}</span>
                <span aria-hidden="true">[{String(count).padStart(2, "0")}]</span>
              </button>
            );
          })}
        </nav>
        <a className="carousel-shell__about" href="/about/">About</a>
      </header>

      <nav className="carousel-shell__static" aria-label="Visible projects">
        {previewProjects.map(({ project, index, position }, previewIndex) => (
          <a
            className={`carousel-shell__static-panel carousel-shell__static-panel--${position}`}
            href={`/projects/${project.slug}/`}
            aria-label={`Open ${project.title}`}
            key={position}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              beginOpen(index);
            }}
          >
            {!sceneReady && (
              <img
                src={project.previewSrc}
                alt=""
                loading="eager"
                fetchPriority={previewIndex === 2 ? "high" : "low"}
                crossOrigin="anonymous"
                decoding="async"
                draggable={false}
              />
            )}
          </a>
        ))}
      </nav>

      <div className="carousel-shell__canvas" aria-hidden="true">
        {sceneEnabled && (
          <CarouselErrorBoundary onError={useStaticFallback}>
            <Suspense fallback={null}>
              <LazyCarouselScene
                projects={filteredProjects}
                slotCount={projects.length}
                navigationCommand={navigationCommand}
                openingIndex={openingIndex}
                reducedMotion={reducedMotion}
                compactTextures={compactTextures}
                onSelect={selectPanel}
                onActive={reportActiveProject}
                onReady={markSceneReady}
                onTextureReady={markActiveTextureReady}
                onContextLost={useStaticFallback}
              />
            </Suspense>
          </CarouselErrorBoundary>
        )}
      </div>

      <div className="carousel-shell__status" aria-live="polite" aria-atomic="true">
        <h1>{activeProject.title}</h1>
        <a
          href={`/projects/${activeProject.slug}/`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            beginOpen(activeIndex);
          }}
        >
          <span className="sr-only">View project</span>
        </a>
      </div>

      <footer className="carousel-shell__footer" aria-hidden="true">
        <p>
          <span>{String(activeProject.order).padStart(2, "0")} —</span>
          <strong>{activeProject.title}</strong>
        </p>
        <span>{activeProject.year}</span>
      </footer>

      <div className="carousel-shell__controls sr-only-controls" role="group" aria-label="Carousel controls">
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
