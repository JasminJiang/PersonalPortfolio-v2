import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  onSelect,
}: {
  project: CarouselProject;
  index: number;
  slotCount: number;
  active: boolean;
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

function CarouselRing({ projects, activeIndex, onSelect }: {
  projects: CarouselProject[];
  activeIndex: number;
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
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

export default function ProjectCarousel({ projects }: Props) {
  const [renderState, setRenderState] = useState<"checking" | "loading" | "ready" | "fallback">("checking");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeProject = projects[activeIndex] ?? projects[0];

  useEffect(() => {
    setActiveIndex(projectIndexFromHash(projects));
    setRenderState(supportsWebGL() ? "loading" : "fallback");

    return () => {
      document.documentElement.removeAttribute("data-carousel-state");
    };
  }, [projects]);

  useEffect(() => {
    document.documentElement.dataset.carouselState = renderState;
  }, [renderState]);

  const selectProject = useCallback((index: number) => {
    const project = projects[index];
    if (!project) return;
    setActiveIndex(index);
    history.replaceState(history.state, "", `/#${project.slug}`);
  }, [projects]);

  const canvasCamera = useMemo(() => ({ position: [0, 0, 5] as [number, number, number], fov: 36 }), []);

  if (!activeProject || renderState === "fallback") return null;

  return (
    <section className="carousel-shell" data-state={renderState} aria-label="Interactive project carousel">
      <div className="carousel-shell__canvas" aria-hidden="true">
        {renderState !== "checking" && (
          <Canvas
            camera={canvasCamera}
            gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
            onCreated={() => setRenderState("ready")}
          >
            <color attach="background" args={["#ffffff"]} />
            <CarouselRing projects={projects} activeIndex={activeIndex} onSelect={selectProject} />
          </Canvas>
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

      <p className="carousel-shell__hint">Select a frame to rotate the collection</p>
    </section>
  );
}
