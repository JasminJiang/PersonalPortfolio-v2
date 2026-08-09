import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group, Mesh, MeshBasicMaterial, Texture } from "three";
import { AdditiveBlending, DoubleSide, LinearFilter, MathUtils, SRGBColorSpace, TextureLoader } from "three";
import type { CarouselProject } from "./ProjectCarousel";
import {
  CAROUSEL_WHEEL_MOTION_EVENT,
  CAROUSEL_WHEEL_ROTATION_FACTOR,
  type CarouselWheelMotionDetail,
} from "./carouselMotion";

const FULL_TURN = Math.PI * 2;
const CAROUSEL_RADIUS = 30;
const WHEEL_FOLLOW_DAMPING = 5;

interface Props {
  projects: CarouselProject[];
  slotCount: number;
  activeIndex: number;
  openingIndex: number | null;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
  onActive: (index: number) => void;
  onReady: () => void;
  onTextureReady: () => void;
  onContextLost: () => void;
}

function CarouselPanel({
  index,
  slotCount,
  active,
  opening,
  dimmed,
  coverSrc,
  reducedMotion,
  onSelect,
  onActiveTextureReady,
  onHoverChange,
}: {
  index: number;
  slotCount: number;
  active: boolean;
  opening: boolean;
  dimmed: boolean;
  coverSrc?: string;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
  onActiveTextureReady: () => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const panel = useRef<Mesh>(null);
  const surface = useRef<MeshBasicMaterial>(null);
  const innerGlow = useRef<MeshBasicMaterial>(null);
  const outerGlow = useRef<MeshBasicMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const [loadedTexture, setLoadedTexture] = useState<{ source: string; texture: Texture } | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const texture = loadedTexture && loadedTexture.source === coverSrc ? loadedTexture.texture : null;
  const angle = -((index / slotCount) * FULL_TURN);
  const x = Math.sin(angle) * CAROUSEL_RADIUS;
  const z = Math.cos(angle) * CAROUSEL_RADIUS;

  useEffect(() => {
    invalidate();
    if (!coverSrc) return;

    let cancelled = false;
    let ownedTexture: Texture | undefined;
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    const retryUrl = new URL(coverSrc);
    retryUrl.searchParams.set("texture-retry", "1");
    const sources = [coverSrc, retryUrl.toString()];

    const loadTexture = (sourceIndex: number) => {
      const source = sources[sourceIndex];
      if (!source) return;
      loader.load(source, (nextTexture) => {
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
      }, undefined, () => {
        if (cancelled) return;
        if (sourceIndex + 1 < sources.length) {
          loadTexture(sourceIndex + 1);
          return;
        }
        invalidate();
      });
    };

    loadTexture(0);

    return () => {
      cancelled = true;
      ownedTexture?.dispose();
    };
  }, [coverSrc, invalidate]);

  useEffect(() => {
    invalidate();
  }, [active, invalidate, reducedMotion]);

  useEffect(() => () => onHoverChange(false), [onHoverChange]);

  useEffect(() => {
    if (active && texture) onActiveTextureReady();
  }, [active, onActiveTextureReady, texture]);

  useFrame((_, delta) => {
    if (!panel.current || !surface.current) return;
    const scale = opening ? 2.9 : hovered && !dimmed ? 1.035 : 1;
    const targetOpacity = dimmed ? 0 : 1;
    const innerGlowOpacity = hovered && !opening && !dimmed ? 0.24 : 0;
    const outerGlowOpacity = hovered && !opening && !dimmed ? 0.12 : 0;
    if (reducedMotion) {
      panel.current.scale.set(scale, scale, 1);
      surface.current.opacity = targetOpacity;
      if (innerGlow.current) innerGlow.current.opacity = 0;
      if (outerGlow.current) outerGlow.current.opacity = 0;
      return;
    }
    panel.current.scale.x = MathUtils.damp(panel.current.scale.x, scale, 7, delta);
    panel.current.scale.y = MathUtils.damp(panel.current.scale.y, scale, 7, delta);
    surface.current.opacity = MathUtils.damp(surface.current.opacity, targetOpacity, 8, delta);
    if (innerGlow.current) {
      innerGlow.current.opacity = MathUtils.damp(innerGlow.current.opacity, innerGlowOpacity, 8, delta);
    }
    if (outerGlow.current) {
      outerGlow.current.opacity = MathUtils.damp(outerGlow.current.opacity, outerGlowOpacity, 7, delta);
    }
    if (
      Math.abs(panel.current.scale.x - scale) > 0.0005
      || Math.abs(surface.current.opacity - targetOpacity) > 0.0005
      || Math.abs((innerGlow.current?.opacity ?? 0) - innerGlowOpacity) > 0.0005
      || Math.abs((outerGlow.current?.opacity ?? 0) - outerGlowOpacity) > 0.0005
    ) {
      invalidate();
    }
  });

  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(index);
  };

  if (!texture) return null;

  return (
    <group position={[x, 0, z]} rotation={[0, angle + Math.PI, 0]}>
      <mesh position={[0, 0, -0.12]}>
        <planeGeometry args={[9.4, 5.8]} />
        <meshBasicMaterial
          ref={outerGlow}
          color="#bcd8ff"
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0, -0.06]}>
        <planeGeometry args={[8.8, 5.2]} />
        <meshBasicMaterial
          ref={innerGlow}
          color="#ffffff"
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
        />
      </mesh>

      <mesh
        ref={panel}
        onClick={handleSelect}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          onHoverChange(true);
          invalidate();
        }}
        onPointerOut={() => {
          setHovered(false);
          onHoverChange(false);
          invalidate();
        }}
      >
        <planeGeometry args={[8, 4.5, 24, 1]} />
        <meshBasicMaterial
          ref={surface}
          color="#ffffff"
          map={texture}
          transparent
          depthWrite={false}
          side={DoubleSide}
        />

      </mesh>
    </group>
  );
}

function CarouselRing({ projects, slotCount, activeIndex, openingIndex, reducedMotion, onSelect, onActive, onTextureReady, onHoverChange }: Omit<Props, "onReady" | "onContextLost"> & { onHoverChange: (hovered: boolean) => void }) {
  const ring = useRef<Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const itemAngle = -((activeIndex / slotCount) * FULL_TURN);
  const targetRotation = Math.PI - itemAngle;
  const alignedTarget = useRef(targetRotation);
  const motionTarget = useRef(targetRotation);
  const lastWheelActiveIndex = useRef<number | null>(null);
  const followingProgrammaticTarget = useRef(true);

  useEffect(() => {
    const current = ring.current?.rotation.y ?? targetRotation;
    const turns = Math.round((current - targetRotation) / FULL_TURN);
    const nearestTarget = targetRotation + turns * FULL_TURN;
    alignedTarget.current = nearestTarget;
    if (lastWheelActiveIndex.current === activeIndex) {
      lastWheelActiveIndex.current = null;
    } else {
      motionTarget.current = nearestTarget;
      followingProgrammaticTarget.current = true;
    }
    invalidate();
  }, [activeIndex, invalidate, reducedMotion, targetRotation]);

  useEffect(() => {
    const handleWheelMotion = (event: Event) => {
      if (reducedMotion || openingIndex !== null || document.hidden) return;
      const detail = (event as CustomEvent<CarouselWheelMotionDetail>).detail;
      if (!detail || !Number.isFinite(detail.delta)) return;
      const delta = MathUtils.clamp(detail.delta, -80, 80);
      const current = ring.current?.rotation.y ?? motionTarget.current;
      const maximumTargetLead = (FULL_TURN / Math.max(slotCount, 1)) * 0.8;
      const wheelRotation = delta * CAROUSEL_WHEEL_ROTATION_FACTOR;
      if (followingProgrammaticTarget.current) {
        const wheelOffset = MathUtils.clamp(
          motionTarget.current - alignedTarget.current + wheelRotation,
          -maximumTargetLead,
          maximumTargetLead,
        );
        motionTarget.current = alignedTarget.current + wheelOffset;
      } else {
        motionTarget.current = MathUtils.clamp(
          motionTarget.current + wheelRotation,
          current - maximumTargetLead,
          current + maximumTargetLead,
        );
      }
      invalidate();
    };

    window.addEventListener(CAROUSEL_WHEEL_MOTION_EVENT, handleWheelMotion);
    return () => window.removeEventListener(CAROUSEL_WHEEL_MOTION_EVENT, handleWheelMotion);
  }, [invalidate, openingIndex, reducedMotion, slotCount]);

  useFrame((_, delta) => {
    if (!ring.current) return;
    const current = ring.current.rotation.y;
    const nextTarget = motionTarget.current;
    if (reducedMotion) {
      ring.current.rotation.y = alignedTarget.current;
      return;
    }
    // Preserve the wheel position after input ends, matching the legacy carousel's
    // free rotation instead of pulling the ring back to the nearest project slot.
    ring.current.rotation.y = MathUtils.damp(current, nextTarget, WHEEL_FOLLOW_DAMPING, delta);
    if (followingProgrammaticTarget.current) {
      if (Math.abs(ring.current.rotation.y - nextTarget) <= 0.002) {
        followingProgrammaticTarget.current = false;
        invalidate();
      }
    } else if (openingIndex === null && projects.length > 0) {
      const step = FULL_TURN / Math.max(slotCount, 1);
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      projects.forEach((_, index) => {
        const baseRotation = Math.PI + index * step;
        const turns = Math.round((ring.current!.rotation.y - baseRotation) / FULL_TURN);
        const distance = Math.abs(ring.current!.rotation.y - (baseRotation + turns * FULL_TURN));
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      if (nearestIndex !== activeIndex && nearestIndex !== lastWheelActiveIndex.current) {
        lastWheelActiveIndex.current = nearestIndex;
        onActive(nearestIndex);
      }
    }
    if (Math.abs(ring.current.rotation.y - nextTarget) > 0.0005) invalidate();

  });

  return (
    <group ref={ring} position={[0, -1.15, 0]} rotation={[0, targetRotation, 0]}>
      {projects.map((project, index) => {
        const directDistance = Math.abs(index - activeIndex);
        const wrappedDistance = Math.min(directDistance, projects.length - directDistance);
        return (
          <CarouselPanel
            key={project.slug}
            index={index}
            slotCount={slotCount}
            active={index === activeIndex}
            opening={index === openingIndex}
            dimmed={openingIndex !== null && index !== openingIndex}
            coverSrc={wrappedDistance <= 3 ? project.previewSrc : undefined}
            reducedMotion={reducedMotion}
            onSelect={onSelect}
            onActiveTextureReady={onTextureReady}
            onHoverChange={onHoverChange}
          />
        );
      })}
    </group>
  );
}

export default function ProjectCarouselScene({
  projects,
  slotCount,
  activeIndex,
  openingIndex,
  reducedMotion,
  onSelect,
  onActive,
  onReady,
  onTextureReady,
  onContextLost,
}: Props) {
  const canvasCamera = useMemo(() => ({ position: [0, 0, 5] as [number, number, number], fov: 36 }), []);
  const [panelHovered, setPanelHovered] = useState(false);

  return (
    <Canvas
      camera={canvasCamera}
      dpr={[1, 1.5]}
      frameloop="demand"
      style={{ cursor: panelHovered ? "pointer" : "default" }}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", onContextLost, { once: true });
        onReady();
      }}
    >
      <color attach="background" args={["#ffffff"]} />
      <CarouselRing
        projects={projects}
        slotCount={slotCount}
        activeIndex={activeIndex}
        openingIndex={openingIndex}
        reducedMotion={reducedMotion}
        onSelect={onSelect}
        onActive={onActive}
        onTextureReady={onTextureReady}
        onHoverChange={setPanelHovered}
      />
    </Canvas>
  );
}
