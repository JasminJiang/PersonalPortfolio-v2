import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import {
  Component,
  type ErrorInfo,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import { MathUtils } from "three";

export interface CarouselProject {
  slug: string;
  order: number;
  title: string;
  categoryLabel: string;
  year: number;
}

interface Props {
  projects: CarouselProject[];
}

const FULL_TURN = Math.PI * 2;
const CAROUSEL_RADIUS = 30;
const DRAG_STEP_PX = 56;

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
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function projectIndexFromHash(projects: CarouselProject[]) {
  const slug = window.location.hash.slice(1);
  const index = projects.findIndex((project) => project.slug === slug);
  return index >= 0 ? index : 0;
}

function CarouselPanel({
  project,
  index,
  slotCount,
  active,
  reducedMotion,
  onSelect,
}: {
  project: CarouselProject;
  index: number;
  slotCount: number;
  active: boolean;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
}) {
  const panel = useRef<Mesh>(null);
  const surface = useRef<MeshBasicMaterial>(null);
  const angle = -((index / slotCount) * FULL_TURN);
  const x = Math.sin(angle) * CAROUSEL_RADIUS;
  const z = Math.cos(angle) * CAROUSEL_RADIUS;
  const shade = 0.925 + ((project.order * 7) % 6) * 0.009;

  useFrame((_, delta) => {
    if (!panel.current || !surface.current) return;
    const scale = active ? 1.08 : 1;
    if (reducedMotion) {
      panel.current.scale.set(scale, scale, 1);
      surface.current.opacity = active ? 1 : 0.72;
      return;
    }
    panel.current.scale.x = MathUtils.damp(panel.current.scale.x, scale, 7, delta);
    panel.current.scale.y = MathUtils.damp(panel.current.scale.y, scale, 7, delta);
    surface.current.opacity = MathUtils.damp(surface.current.opacity, active ? 1 : 0.72, 8, delta);
  });

  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(index);
  };

  return (
    <group position={[x, 0, z]} rotation={[0, angle + Math.PI, 0]}>
      <mesh position={[0, 0, -0.035]}>
        <planeGeometry args={[8.14, 4.64]} />
        <meshBasicMaterial color="#10100f" transparent opacity={active ? 0.72 : 0.18} />
      </mesh>

      <mesh ref={panel} onClick={handleSelect}>
        <planeGeometry args={[8, 4.5, 24, 1]} />
        <meshBasicMaterial ref={surface} color={[shade, shade, shade - 0.018]} transparent side={2} />

        <mesh position={[-2.84, 1.6, 0.012]}>
          <planeGeometry args={[1.82, 0.08]} />
          <meshBasicMaterial color="#10100f" transparent opacity={0.58} />
        </mesh>
        <mesh position={[-2.55, -1.62, 0.012]}>
          <planeGeometry args={[2.4, 0.045]} />
          <meshBasicMaterial color="#10100f" transparent opacity={0.22} />
        </mesh>
        <mesh position={[2.95, -1.62, 0.012]}>
          <planeGeometry args={[1.25, 0.045]} />
          <meshBasicMaterial color="#10100f" transparent opacity={0.22} />
        </mesh>
      </mesh>
    </group>
  );
}

function CarouselRing({ projects, activeIndex, reducedMotion, onSelect }: {
  projects: CarouselProject[];
  activeIndex: number;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
}) {
  const ring = useRef<Group>(null);
  const itemAngle = -((activeIndex / projects.length) * FULL_TURN);
  const targetRotation = Math.PI - itemAngle;

  useFrame((_, delta) => {
    if (!ring.current) return;
    const current = ring.current.rotation.y;
    const turns = Math.round((current - targetRotation) / FULL_TURN);
    const nearestTarget = targetRotation + turns * FULL_TURN;
    if (reducedMotion) {
      ring.current.rotation.y = nearestTarget;
      return;
    }
    ring.current.rotation.y = MathUtils.damp(current, nearestTarget, 5.5, delta);
  });

  return (
    <group ref={ring} rotation={[0, targetRotation, 0]}>
      {projects.map((project, index) => (
        <CarouselPanel
          key={project.slug}
          project={project}
          index={index}
          slotCount={projects.length}
          active={index === activeIndex}
          reducedMotion={reducedMotion}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

export default function ProjectCarousel({ projects }: Props) {
  const [renderState, setRenderState] = useState<"checking" | "loading" | "ready" | "fallback">("checking");
  const [activeIndex, setActiveIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const shell = useRef<HTMLElement>(null);
  const activeIndexRef = useRef(0);
  const suppressPanelSelectUntil = useRef(0);
  const contextCleanup = useRef<(() => void) | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    stepX: number;
    moved: boolean;
  } | null>(null);
  const activeProject = projects[activeIndex] ?? projects[0];
  const previousProject = projects[(activeIndex - 1 + projects.length) % projects.length];
  const nextProject = projects[(activeIndex + 1) % projects.length];

  useEffect(() => {
    const initialIndex = projectIndexFromHash(projects);
    activeIndexRef.current = initialIndex;
    setActiveIndex(initialIndex);
    setRenderState(supportsWebGL() ? "loading" : "fallback");

    return () => {
      contextCleanup.current?.();
      document.documentElement.removeAttribute("data-carousel-state");
    };
  }, [projects]);

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
    activateProject(activeIndexRef.current + distance);
  }, [activateProject]);

  const selectPanel = useCallback((index: number) => {
    if (performance.now() < suppressPanelSelectUntil.current) return;
    activateProject(index);
  }, [activateProject]);

  useEffect(() => {
    const element = shell.current;
    if (!element || renderState !== "ready") return;

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

  const useStaticFallback = useCallback(() => setRenderState("fallback"), []);

  const canvasCamera = useMemo(() => ({ position: [0, 0, 5] as [number, number, number], fov: 36 }), []);

  if (!activeProject || renderState === "fallback") return null;

  return (
    <section
      ref={shell}
      className="carousel-shell"
      data-state={renderState}
      aria-label="Interactive project carousel"
      aria-roledescription="carousel"
      aria-describedby="carousel-instructions"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointerGesture}
      onPointerCancel={endPointerGesture}
    >
      <div className="carousel-shell__canvas" aria-hidden="true">
        {renderState !== "checking" && (
          <CarouselErrorBoundary onError={useStaticFallback}>
            <Canvas
              camera={canvasCamera}
              gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
              onCreated={({ gl }) => {
                const canvas = gl.domElement;
                const handleContextLoss = () => setRenderState("fallback");
                canvas.addEventListener("webglcontextlost", handleContextLoss, { once: true });
                contextCleanup.current?.();
                contextCleanup.current = () => canvas.removeEventListener("webglcontextlost", handleContextLoss);
                setRenderState("ready");
              }}
            >
              <color attach="background" args={["#ffffff"]} />
              <CarouselRing
                projects={projects}
                activeIndex={activeIndex}
                reducedMotion={reducedMotion}
                onSelect={selectPanel}
              />
            </Canvas>
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
