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

export interface CarouselProject {
  slug: string;
  order: number;
  title: string;
  category: "architecture" | "immersive-media" | "ui-ux" | "photography";
  categoryLabel: string;
  year: number;
  coverSrc: string;
  previewSrc: string;
}

interface Props {
  projects: CarouselProject[];
}

const DRAG_STEP_PX = 56;
const AUTOMATIC_SCENE_DELAY_MS = 0;
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
  const shell = useRef<HTMLElement>(null);
  const activeIndexRef = useRef(0);
  const sceneRequested = useRef(false);
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

  const requestScene = useCallback(() => {
    if (sceneRequested.current) return;
    sceneRequested.current = true;
    setSceneEnabled(true);
  }, []);

  useEffect(() => {
    let automaticSceneTimer: number | undefined;
    const setupFrame = window.requestAnimationFrame(() => {
      const initialIndex = projectIndexFromHash(filteredProjects);
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
  }, [filteredProjects, requestScene]);

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
    if (filteredProjects.length === 0) return;
    const index = (requestedIndex + filteredProjects.length) % filteredProjects.length;
    const project = filteredProjects[index];
    if (!project) return;
    activeIndexRef.current = index;
    setActiveIndex(index);
    history.replaceState(history.state, "", `/#${project.slug}`);
  }, [filteredProjects]);

  const moveBy = useCallback((distance: number) => {
    if (openingIndex !== null) return;
    requestScene();
    activateProject(activeIndexRef.current + distance);
  }, [activateProject, openingIndex, requestScene]);

  const beginOpen = useCallback((index: number) => {
    if (openingIndex !== null) return;
    const project = filteredProjects[index];
    if (!project) return;
    activeIndexRef.current = index;
    setActiveIndex(index);
    setOpeningIndex(index);
    history.replaceState(history.state, "", `/#${project.slug}`);
    openingTimer.current = window.setTimeout(() => {
      void navigate(`/projects/${project.slug}/`);
    }, reducedMotion ? 40 : 560);
  }, [filteredProjects, openingIndex, reducedMotion]);

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
    requestScene();
  }, [filter, projects, requestScene]);

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
      End: () => activateProject(filteredProjects.length - 1),
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
  const markSceneReady = useCallback(() => setSceneReady(true), []);
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
            key={`${project.slug}-${previewIndex}`}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              beginOpen(index);
            }}
          >
            <img
              src={previewIndex === 2 || Math.abs(previewIndex - 2) === 1 ? project.coverSrc : project.previewSrc}
              alt=""
              loading="eager"
              fetchPriority={previewIndex === 2 ? "high" : "low"}
              crossOrigin="anonymous"
              decoding="async"
              draggable={false}
            />
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
                activeIndex={activeIndex}
                openingIndex={openingIndex}
                reducedMotion={reducedMotion}
                onSelect={selectPanel}
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
