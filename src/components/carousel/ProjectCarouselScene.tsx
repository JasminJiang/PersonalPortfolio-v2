import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group, Mesh, MeshBasicMaterial, Texture } from "three";
import { LinearFilter, MathUtils, SRGBColorSpace, TextureLoader } from "three";
import type { CarouselProject } from "./ProjectCarousel";

const FULL_TURN = Math.PI * 2;
const CAROUSEL_RADIUS = 30;

interface Props {
  projects: CarouselProject[];
  activeIndex: number;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
  onReady: () => void;
  onContextLost: () => void;
}

function CarouselPanel({
  project,
  index,
  slotCount,
  active,
  coverSrc,
  reducedMotion,
  onSelect,
}: {
  project: CarouselProject;
  index: number;
  slotCount: number;
  active: boolean;
  coverSrc?: string;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
}) {
  const panel = useRef<Mesh>(null);
  const surface = useRef<MeshBasicMaterial>(null);
  const [loadedTexture, setLoadedTexture] = useState<{ source: string; texture: Texture } | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const texture = loadedTexture && loadedTexture.source === coverSrc ? loadedTexture.texture : null;
  const angle = -((index / slotCount) * FULL_TURN);
  const x = Math.sin(angle) * CAROUSEL_RADIUS;
  const z = Math.cos(angle) * CAROUSEL_RADIUS;
  const shade = 0.925 + ((project.order * 7) % 6) * 0.009;

  useEffect(() => {
    invalidate();
    if (!coverSrc) return;

    let cancelled = false;
    let ownedTexture: Texture | undefined;
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      coverSrc,
      (nextTexture) => {
        ownedTexture = nextTexture;
        nextTexture.colorSpace = SRGBColorSpace;
        nextTexture.minFilter = LinearFilter;
        nextTexture.generateMipmaps = false;
        if (cancelled) {
          nextTexture.dispose();
          return;
        }
        setLoadedTexture({ source: coverSrc, texture: nextTexture });
        invalidate();
      },
      undefined,
      () => {
        if (!cancelled) invalidate();
      },
    );

    return () => {
      cancelled = true;
      ownedTexture?.dispose();
    };
  }, [coverSrc, invalidate]);

  useEffect(() => {
    invalidate();
  }, [active, invalidate, reducedMotion]);

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
    if (
      Math.abs(panel.current.scale.x - scale) > 0.0005
      || Math.abs(surface.current.opacity - (active ? 1 : 0.72)) > 0.0005
    ) {
      invalidate();
    }
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
        <meshBasicMaterial
          ref={surface}
          color={texture ? "#ffffff" : [shade, shade, shade - 0.018]}
          map={texture}
          transparent
          side={2}
        />

        {!texture && (
          <>
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
          </>
        )}
      </mesh>
    </group>
  );
}

function CarouselRing({ projects, activeIndex, reducedMotion, onSelect }: Omit<Props, "onReady" | "onContextLost">) {
  const ring = useRef<Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const itemAngle = -((activeIndex / projects.length) * FULL_TURN);
  const targetRotation = Math.PI - itemAngle;

  useEffect(() => {
    invalidate();
  }, [invalidate, reducedMotion, targetRotation]);

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
    if (Math.abs(ring.current.rotation.y - nearestTarget) > 0.0005) invalidate();
  });

  return (
    <group ref={ring} rotation={[0, targetRotation, 0]}>
      {projects.map((project, index) => {
        const directDistance = Math.abs(index - activeIndex);
        const wrappedDistance = Math.min(directDistance, projects.length - directDistance);
        if (wrappedDistance > 3) return null;
        return (
          <CarouselPanel
            key={project.slug}
            project={project}
            index={index}
            slotCount={projects.length}
            active={index === activeIndex}
            coverSrc={wrappedDistance <= 1 ? project.coverSrc : undefined}
            reducedMotion={reducedMotion}
            onSelect={onSelect}
          />
        );
      })}
    </group>
  );
}

export default function ProjectCarouselScene({
  projects,
  activeIndex,
  reducedMotion,
  onSelect,
  onReady,
  onContextLost,
}: Props) {
  const canvasCamera = useMemo(() => ({ position: [0, 0, 5] as [number, number, number], fov: 36 }), []);

  return (
    <Canvas
      camera={canvasCamera}
      dpr={[1, 1.5]}
      frameloop="demand"
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", onContextLost, { once: true });
        onReady();
      }}
    >
      <color attach="background" args={["#ffffff"]} />
      <CarouselRing
        projects={projects}
        activeIndex={activeIndex}
        reducedMotion={reducedMotion}
        onSelect={onSelect}
      />
    </Canvas>
  );
}
